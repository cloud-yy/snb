import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AccountAccess, DirectDebit, Ledger, sequelize } from "#models/models"
import { transfer } from "#functions/db/account"
import { currentWeekStart } from "#functions/util/accountActivity"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"

function cents(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 99999999.99) {
        throw new Error("INVALID_AMOUNT")
    }
    const rounded = Math.round(value * 100)
    if (!Number.isSafeInteger(rounded) || Math.abs(value * 100 - rounded) > 0.000001) {
        throw new Error("INVALID_AMOUNT")
    }
    return rounded
}

export function isBusinessAccount(account) {
    return config.accounts?.[account?.type]?.type === "business"
}

async function canAct(user, accountId, access, transaction) {
    return Boolean(await AccountAccess.findOne({
        attributes: ["id"],
        where: { userId: user.id, accountId, access: { [Op.gte]: access } },
        transaction
    }))
}

export async function authorizeDirectDebit(actor, payor, payee, currency, maxAmount, weeklyLimit, totalLimit) {
    const maxCents = cents(maxAmount)
    const weeklyCents = cents(weeklyLimit)
    const totalCents = totalLimit == null ? null : cents(totalLimit)
    if (!actor || !payor || !payee || String(payor.id) === String(payee.id)
        || !config.currencies.includes(currency) || (totalCents !== null && totalCents < maxCents) || weeklyCents < maxCents) {
        throw new Error("INVALID_MANDATE")
    }

    return sequelize.transaction(async transaction => {
        const accounts = await Account.findAll({
            attributes: ["id", "type", "status"],
            where: { id: { [Op.in]: [payor.id, payee.id] } },
            order: [["id", "ASC"]], transaction, lock: transaction.LOCK.UPDATE
        })
        const lockedPayor = accounts.find(account => String(account.id) === String(payor.id))
        const lockedPayee = accounts.find(account => String(account.id) === String(payee.id))
        if (!lockedPayor || !lockedPayee || lockedPayor.status !== "ACTIVE" || lockedPayee.status !== "ACTIVE") {
            throw new Error("ACCOUNT_UNAVAILABLE")
        }
        if (!isBusinessAccount(lockedPayee)) throw new Error("BUSINESS_ACCOUNT_REQUIRED")
        if (!await canAct(actor, payor.id, config.accountAccesses.Holder, transaction)) {
            throw new Error("HOLDER_REQUIRED")
        }

        const mandate = await DirectDebit.create({
            payorId: payor.id, payeeId: payee.id, authorizedById: actor.id,
            currency, maxAmount: maxCents / 100, weeklyLimit: weeklyCents / 100,
            totalLimit: totalCents === null ? null : totalCents / 100
        }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: payor.id, action: "DIRECT_DEBIT_AUTHORIZED", before: null,
            after: { mandateId: mandate.id, payeeId: payee.id, currency, maxAmount: maxCents / 100,
                weeklyLimit: weeklyCents / 100, totalLimit: totalCents === null ? null : totalCents / 100 }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return mandate
    })
}

export async function collectDirectDebit(actor, mandateId, amount, reference) {
    const amountCents = cents(amount)
    if (!actor || !/^\d+$/.test(String(mandateId)) || !reference?.trim() || reference.length > 18) {
        throw new Error("INVALID_COLLECTION")
    }

    return sequelize.transaction(async transaction => {
        const mandate = await DirectDebit.findByPk(mandateId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!mandate || mandate.status !== "ACTIVE") throw new Error("MANDATE_UNAVAILABLE")
        const [payor, payee] = await Promise.all([
            Account.findByPk(mandate.payorId, { transaction }),
            Account.findByPk(mandate.payeeId, { transaction })
        ])
        if (!payor || !payee) throw new Error("ACCOUNT_UNAVAILABLE")
        if (amountCents > Math.round(Number(mandate.maxAmount) * 100)
            || (mandate.totalLimit !== null && mandate.totalLimit !== undefined
                && amountCents + Math.round(Number(mandate.totalCollected) * 100) > Math.round(Number(mandate.totalLimit) * 100))) {
            throw new Error("MANDATE_LIMIT_EXCEEDED")
        }
        const collectedThisWeek = await Ledger.sum("amount", {
            where: {
                directDebitId: mandate.id,
                status: "SUCCESS",
                createdAt: { [Op.gte]: currentWeekStart() }
            }, transaction
        })
        if (amountCents + Math.round(Number(collectedThisWeek || 0) * 100) > Math.round(Number(mandate.weeklyLimit) * 100)) {
            throw new Error("MANDATE_WEEKLY_LIMIT_EXCEEDED")
        }

        const ledger = await transfer(payor, payee, amountCents / 100, mandate.currency, reference.trim(), actor, {
            transaction, ledgerType: "DIRECT_DEBIT", auditAction: "DIRECT_DEBIT_COLLECTED",
            directDebitId: mandate.id, notifyAudit: false,
            authorize: async lockedAccounts => {
                const receivingAccount = lockedAccounts.find(account => String(account.id) === String(payee.id))
                if (!isBusinessAccount(receivingAccount)) throw new Error("BUSINESS_ACCOUNT_REQUIRED")
                if (!await canAct(actor, payee.id, config.accountAccesses.Signatory, transaction)) {
                    throw new Error("BUSINESS_ACCESS_REQUIRED")
                }
            }
        })
        await mandate.increment("totalCollected", { by: amountCents / 100, transaction })
        return { ledger, mandate, payor, payee }
    })
}

export async function revokeDirectDebit(actor, mandateId) {
    if (!actor || !/^\d+$/.test(String(mandateId))) throw new Error("INVALID_MANDATE")
    return sequelize.transaction(async transaction => {
        const mandate = await DirectDebit.findByPk(mandateId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!mandate || mandate.status !== "ACTIVE") throw new Error("MANDATE_UNAVAILABLE")
        if (!await canAct(actor, mandate.payorId, config.accountAccesses.Holder, transaction)
            && !await canAct(actor, mandate.payeeId, config.accountAccesses.Holder, transaction)) {
            throw new Error("HOLDER_REQUIRED")
        }
        await mandate.update({ status: "REVOKED" }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: mandate.payorId, action: "DIRECT_DEBIT_REVOKED",
            before: { mandateId: mandate.id, status: "ACTIVE" },
            after: { mandateId: mandate.id, status: "REVOKED" }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return mandate
    })
}
