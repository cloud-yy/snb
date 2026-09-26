import { Account, AccountAccess, AccountBalance, Ledger, sequelize } from "#models/models"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import generateAccountNumber from "#functions/util/generateAccountNumber"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"

export async function createAccount(owner, type = "General", chosenName, { notifyAudit = false, auditActor = owner } = {}) {
    if (!owner) {
        return
    }

    const accountConfig = config.accounts?.[type]

    if (
        !accountConfig
        || (
            accountConfig.access?.Holder !== true
            && (!Number.isInteger(accountConfig.access?.Holder) || accountConfig.access.Holder < 1)
        )
    ) {
        return
    }

    const name = chosenName || `${owner.robloxName}'s ${type} Account`

    try {
        const result = sequelize.transaction(async transaction => {
            const account = await Account.create({
                status: "ACTIVE",
                type,
                name,
                number: await generateAccountNumber(4)
            }, {transaction})

            await owner.addAccount(account, {
                through: { access: config.accountAccesses.Holder },
                transaction
            })

            const auditLog = await auditActor.createAuditLog({
                accountId: account.id,
                action: "ACCOUNT_CREATED",
                before: null,
                after: account.toJSON()
            }, {transaction})
            if (notifyAudit) queueAuditLogNotification(auditLog, transaction)

            return account
        })

        return result
    } catch (error) {
        console.error(error)

        return null
    }
}

export async function hasAccountAccess(user, account, requiredAccess = config.accountAccesses.Viewer) {
    if (!user || !account || !Number.isInteger(requiredAccess)) {
        return false
    }

    const access = await AccountAccess.findOne({
        where: {
            userId: user.id,
            accountId: account.id,
            access: { [Op.gte]: requiredAccess }
        },
        attributes: ["id"]
    })

    return Boolean(access)
}

export async function getAccountAccess(user, account) {
    if (!user || !account) {
        return null
    }

    const accountAccess = await AccountAccess.findOne({
        where: {
            userId: user.id,
            accountId: account.id
        },
        attributes: ["access"]
    })

    return accountAccess?.access ?? null
}

export async function removeAccountAccess(actor, user, account) {
    if (!actor || !user || !account) {
        throw new Error("INVALID_ACCOUNT_ACCESS")
    }

    return await sequelize.transaction(async transaction => {
        const lockedAccount = await Account.findByPk(account.id, {
            attributes: ["id", "status"],
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        if (!lockedAccount || lockedAccount.status === "CLOSED") {
            throw new Error("ACCOUNT_CLOSED")
        }

        const accountAccesses = await AccountAccess.findAll({
            attributes: ["id", "userId", "access"],
            where: { accountId: account.id },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        const existingAccess = accountAccesses.find(accountAccess => String(accountAccess.userId) === String(user.id))

        if (!existingAccess) {
            throw new Error("ACCOUNT_ACCESS_NOT_FOUND")
        }

        if (
            Number(existingAccess.access) === config.accountAccesses.Holder
            && accountAccesses.filter(accountAccess => Number(accountAccess.access) === config.accountAccesses.Holder).length === 1
        ) {
            throw new Error("LAST_ACCOUNT_HOLDER")
        }

        const before = { userId: user.id, access: existingAccess.access }

        await existingAccess.destroy({ transaction })

        await actor.createAuditLog({
            accountId: account.id,
            action: "ACCOUNT_ACCESS_REMOVED",
            before,
            after: null
        }, { transaction })
    })
}

export async function setAccountStatus(actor, account, status, reason, { notifyAudit = false } = {}) {
    const cleanReason = reason?.trim()

    if (!actor || !account || !["ACTIVE", "FROZEN", "CLOSED"].includes(status) || !cleanReason) {
        throw new Error("INVALID_ACCOUNT_STATUS")
    }

    return await sequelize.transaction(async transaction => {
        const lockedAccount = await Account.findByPk(account.id, {
            attributes: ["id", "status"],
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        if (!lockedAccount) {
            throw new Error("ACCOUNT_NOT_FOUND")
        }

        if (lockedAccount.status === status) {
            throw new Error(`ACCOUNT_ALREADY_${status}`)
        }

        const before = { status: lockedAccount.status }

        await lockedAccount.update({ status }, { transaction })

        const auditLog = await actor.createAuditLog({
            accountId: account.id,
            action: `ACCOUNT_${status}`,
            before,
            after: { status, reason: cleanReason }
        }, { transaction })
        if (notifyAudit) queueAuditLogNotification(auditLog, transaction)

        return lockedAccount
    })
}

export async function setAccountAccess(actor, user, account, access, { bypassLimits = false, bypassStatus = false, notifyAudit = false } = {}) {
    if (!actor || !user || !account || !Object.values(config.accountAccesses).includes(access)) {
        throw new Error("INVALID_ACCOUNT_ACCESS")
    }

    return await sequelize.transaction(async transaction => {
        const lockedAccount = await Account.findByPk(account.id, {
            attributes: ["id", "status", "type"],
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        if (!lockedAccount || (!bypassStatus && lockedAccount.status === "CLOSED")) {
            throw new Error("ACCOUNT_CLOSED")
        }

        const roleName = Object.entries(config.accountAccesses)
            .find(([, value]) => value === access)?.[0]
        const limit = config.accounts?.[lockedAccount.type]?.access?.[roleName]

        if (!bypassLimits && limit !== true && (!Number.isInteger(limit) || limit < 1)) {
            throw new Error("ACCOUNT_ACCESS_NOT_ALLOWED")
        }

        const accountAccesses = await AccountAccess.findAll({
            attributes: ["id", "userId", "access"],
            where: {
                accountId: account.id
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        const existingAccess = accountAccesses.find(accountAccess => String(accountAccess.userId) === String(user.id))

        if (
            !bypassLimits
            && limit !== true
            && Number(existingAccess?.access) !== access
            && accountAccesses.filter(accountAccess => Number(accountAccess.access) === access).length >= limit
        ) {
            throw new Error("ACCOUNT_ACCESS_LIMIT_REACHED")
        }

        const before = existingAccess
            ? { userId: user.id, access: existingAccess.access }
            : null

        if (existingAccess) {
            await existingAccess.update({ access }, { transaction })
        } else {
            await AccountAccess.create({
                userId: user.id,
                accountId: account.id,
                access
            }, { transaction })
        }

        const auditLog = await actor.createAuditLog({
            accountId: account.id,
            action: "ACCOUNT_ACCESS_UPDATED",
            before,
            after: { userId: user.id, access }
        }, { transaction })
        if (notifyAudit) queueAuditLogNotification(auditLog, transaction)

        return access
    })
}

export async function transfer(from, to, rawAmount, currency, reference, user, {
    overdraft = false,
    bypassStatus = false,
    notifyAudit = false,
    transaction: existingTransaction,
    ledgerType = "TRANSFER",
    auditAction = "TRANSFER"
} = {}) {
    if (from.id === to.id) {
        throw new Error("SAME_ACCOUNT")
    }

    if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount)) {
        throw new Error("INVALID_AMOUNT")
    }

    const amount = Math.round(rawAmount * 100) / 100

    if (amount <= 0 || !Number.isFinite(amount)) {
        throw new Error("INVALID_AMOUNT")
    }

    const performTransfer = async transaction => {
        const lockedAccounts = await Account.findAll({
            attributes: ["id", "status"],
            where: { id: { [Op.in]: [from.id, to.id] } },
            order: [["id", "ASC"]],
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        if (lockedAccounts.length !== 2) {
            throw new Error("ACCOUNT_NOT_FOUND")
        }

        if (!bypassStatus && lockedAccounts.some(account => account.status === "CLOSED")) {
            throw new Error("ACCOUNT_CLOSED")
        }

        if (!bypassStatus && lockedAccounts.some(account => account.status === "FROZEN")) {
            throw new Error("ACCOUNT_FROZEN")
        }

        const fromFirst = String(from.id) < String(to.id)
        const firstAccount = fromFirst ? from : to
        const secondAccount = fromFirst ? to : from

        await AccountBalance.findOrCreate({
            attributes: ["id"],
            where: {
                accountId: firstAccount.id,
                currency
            },
            transaction
        })

        const firstBalance = await AccountBalance.findOne({
            attributes: ["id", "balance"],
            where: {
                accountId: firstAccount.id,
                currency
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        await AccountBalance.findOrCreate({
            attributes: ["id"],
            where: {
                accountId: secondAccount.id,
                currency
            },
            transaction
        })

        const secondBalance = await AccountBalance.findOne({
            attributes: ["id", "balance"],
            where: {
                accountId: secondAccount.id,
                currency
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        const fromBalance = fromFirst ? firstBalance : secondBalance
        const toBalance = fromFirst ? secondBalance : firstBalance

        if (fromBalance.balance < amount && !overdraft) {
            throw new Error("INSUFFICIENT_FUNDS")
        }

        let oldFromBalance = fromBalance.balance

        await fromBalance.increment("balance", {
            by: -amount,
            transaction
        })

        await toBalance.increment("balance", {
            by: amount,
            transaction
        })

        const ledger = await Ledger.create({
            payorId: from.id,
            payeeId: to.id,
            amount,
            currency,
            status: "SUCCESS",
            type: ledgerType,
            reference
        }, { transaction })

        if (user) {
            await fromBalance.reload({ transaction })

            const auditLog = await user.createAuditLog({
                action: auditAction,
                before: { balance: oldFromBalance },
                after:  { balance: fromBalance.balance },
                accountId: from.id,
                ledgerId: ledger.id
            }, { transaction })
            if (notifyAudit) queueAuditLogNotification(auditLog, transaction)
        }

        return ledger
    }

    return existingTransaction
        ? performTransfer(existingTransaction)
        : sequelize.transaction(performTransfer)
}

export async function accountFromNumber(number, transaction) {
    return await Account.findOne({
        attributes: ["id", "name", "number", "status", "type", "createdAt", "updatedAt"],
        where: { number },
        ...transaction && { transaction }
    })
}
