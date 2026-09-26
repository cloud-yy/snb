import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AccountAccess, Pap, PapRequest, Ledger, sequelize } from "#models/models"
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

async function lockedAccounts(payorId, payeeId, transaction) {
    const accounts = await Account.findAll({
        attributes: ["id", "name", "number", "type", "status"],
        where: { id: { [Op.in]: [payorId, payeeId] } },
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
    })
    const payor = accounts.find(account => String(account.id) === String(payorId))
    const payee = accounts.find(account => String(account.id) === String(payeeId))
    if (!payor || !payee || payor.status !== "ACTIVE" || payee.status !== "ACTIVE") throw new Error("ACCOUNT_UNAVAILABLE")
    if (!isBusinessAccount(payee)) throw new Error("BUSINESS_ACCOUNT_REQUIRED")
    return { payor, payee }
}

export async function authorizePap(actor, payor, payee, currency, weeklyLimit) {
    const weeklyCents = cents(weeklyLimit)
    if (!actor || !payor || !payee || String(payor.id) === String(payee.id) || !config.currencies.includes(currency)) {
        throw new Error("INVALID_PAP")
    }

    return sequelize.transaction(async transaction => {
        const accounts = await lockedAccounts(payor.id, payee.id, transaction)
        if (!await canAct(actor, accounts.payor.id, config.accountAccesses.Holder, transaction)) throw new Error("HOLDER_REQUIRED")

        const existing = await Pap.findOne({
            where: { payorId: accounts.payor.id, payeeId: accounts.payee.id },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (existing?.status === "ACTIVE") throw new Error("PAP_EXISTS")

        const previousStatus = existing?.status
        const pap = existing || await Pap.create({
            payorId: accounts.payor.id,
            payeeId: accounts.payee.id,
            authorizedById: actor.id,
            currency,
            weeklyLimit: weeklyCents / 100
        }, { transaction })
        if (existing) {
            await existing.update({
                authorizedById: actor.id,
                currency,
                weeklyLimit: weeklyCents / 100,
                status: "ACTIVE"
            }, { transaction })
        }
        const auditLog = await actor.createAuditLog({
            accountId: accounts.payor.id,
            action: "PAP_AUTHORIZED",
            before: existing ? { papId: existing.id, status: previousStatus } : null,
            after: { papId: pap.id, payeeId: accounts.payee.id, currency, weeklyLimit: weeklyCents / 100 }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return pap
    })
}

export async function editPap(actor, payor, payee, weeklyLimit) {
    const weeklyCents = cents(weeklyLimit)
    if (!actor || !payor || !payee) throw new Error("INVALID_PAP")

    return sequelize.transaction(async transaction => {
        const accounts = await lockedAccounts(payor.id, payee.id, transaction)
        if (!await canAct(actor, accounts.payor.id, config.accountAccesses.Holder, transaction)) throw new Error("HOLDER_REQUIRED")
        const pap = await Pap.findOne({
            where: { payorId: accounts.payor.id, payeeId: accounts.payee.id, status: "ACTIVE" },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!pap) throw new Error("PAP_UNAVAILABLE")
        const before = { weeklyLimit: pap.weeklyLimit }
        await pap.update({ weeklyLimit: weeklyCents / 100 }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: accounts.payor.id,
            action: "PAP_UPDATED",
            before,
            after: { papId: pap.id, weeklyLimit: weeklyCents / 100, payeeId: accounts.payee.id }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return pap
    })
}

export async function collectPap(actor, payorNumber, payeeAccount, amount, reference, { apiPayeeId } = {}) {
    const amountCents = cents(amount)
    if (!actor || !payeeAccount || !/^\d+$/.test(String(payorNumber)) || !reference?.trim() || reference.length > 18) {
        throw new Error("INVALID_COLLECTION")
    }
    if (apiPayeeId && String(payeeAccount.id) !== String(apiPayeeId)) throw new Error("PAP_UNAVAILABLE")

    return sequelize.transaction(async transaction => {
        const payor = await Account.findOne({ where: { number: String(payorNumber) }, transaction })
        if (!payor) throw new Error("ACCOUNT_UNAVAILABLE")
        const pap = await Pap.findOne({
            where: { payorId: payor.id, payeeId: payeeAccount.id, status: "ACTIVE" },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!pap) throw new Error("PAP_UNAVAILABLE")
        const payee = await Account.findByPk(pap.payeeId, { transaction })
        if (!payee) throw new Error("ACCOUNT_UNAVAILABLE")

        const collectedThisWeek = await Ledger.sum("amount", {
            where: {
                papId: pap.id,
                status: "SUCCESS",
                createdAt: { [Op.gte]: currentWeekStart() }
            },
            transaction
        })
        if (amountCents + Math.round(Number(collectedThisWeek || 0) * 100) > Math.round(Number(pap.weeklyLimit) * 100)) {
            throw new Error("PAP_WEEKLY_LIMIT_EXCEEDED")
        }

        const ledger = await transfer(payor, payee, amountCents / 100, pap.currency, reference.trim(), actor, {
            transaction,
            ledgerType: "PAP",
            auditAction: "PAP_COLLECTED",
            papId: pap.id,
            notifyAudit: false,
            authorize: async locked => {
                const receivingAccount = locked.find(account => String(account.id) === String(payee.id))
                if (!isBusinessAccount(receivingAccount)) throw new Error("BUSINESS_ACCOUNT_REQUIRED")
                if (!apiPayeeId && !await canAct(actor, payee.id, config.accountAccesses.Signatory, transaction)) {
                    throw new Error("BUSINESS_ACCESS_REQUIRED")
                }
            }
        })
        return { ledger, pap, payor, payee }
    })
}

export async function papForPayee(payeeId, payorNumber) {
    const pap = await Pap.findOne({
        where: { payeeId },
        include: [{
            model: Account,
            as: "payor",
            attributes: ["id", "name", "number", "status", "type"],
            where: { number: String(payorNumber) }
        }]
    })
    if (!pap) throw new Error("PAP_UNAVAILABLE")
    const collectedThisWeek = await Ledger.sum("amount", {
        where: { papId: pap.id, status: "SUCCESS", createdAt: { [Op.gte]: currentWeekStart() } }
    })
    return { pap, collectedThisWeek: Number(collectedThisWeek || 0) }
}

export async function createPapRequest(actor, payor, payee, currency, weeklyLimit, reference) {
    const weeklyCents = cents(weeklyLimit)
    const cleanReference = reference?.trim()
    if (!actor || !payor || !payee || String(payor.id) === String(payee.id)
        || !config.currencies.includes(currency) || !cleanReference || cleanReference.length > 100) {
        throw new Error("INVALID_PAP")
    }

    return sequelize.transaction(async transaction => {
        const accounts = await lockedAccounts(payor.id, payee.id, transaction)
        if (!await canAct(actor, accounts.payee.id, config.accountAccesses.Signatory, transaction)) {
            throw new Error("BUSINESS_ACCESS_REQUIRED")
        }
        const existing = await Pap.findOne({
            attributes: ["id", "status"],
            where: { payorId: accounts.payor.id, payeeId: accounts.payee.id },
            transaction
        })
        if (existing?.status === "ACTIVE") throw new Error("PAP_EXISTS")
        const pending = await PapRequest.findOne({
            attributes: ["id"],
            where: { payorId: accounts.payor.id, payeeId: accounts.payee.id, status: "PENDING" },
            transaction
        })
        if (pending) throw new Error("PAP_REQUEST_PENDING")

        const request = await PapRequest.create({
            payorId: accounts.payor.id,
            payeeId: accounts.payee.id,
            requestedById: actor.id,
            currency,
            weeklyLimit: weeklyCents / 100,
            reference: cleanReference
        }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: accounts.payee.id,
            action: "PAP_REQUESTED",
            before: null,
            after: { requestId: request.id, payorId: accounts.payor.id, currency, weeklyLimit: weeklyCents / 100 }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return { request, payor: accounts.payor, payee: accounts.payee }
    })
}

export async function papRequestForPayee(payeeId, requestId) {
    const request = await PapRequest.findOne({
        where: { id: requestId, payeeId },
        include: [{ model: Account, as: "payor", attributes: ["id", "name", "number", "status", "type"] }]
    })
    if (!request) throw new Error("PAP_REQUEST_UNAVAILABLE")
    return request
}

export async function respondToPapRequest(actor, requestId, action) {
    if (!actor || !["AUTHORIZED", "DECLINED"].includes(action)) throw new Error("PAP_REQUEST_UNAVAILABLE")

    return sequelize.transaction(async transaction => {
        const request = await PapRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!request || request.status !== "PENDING") throw new Error("PAP_REQUEST_UNAVAILABLE")
        const accounts = await lockedAccounts(request.payorId, request.payeeId, transaction)
        if (!await canAct(actor, accounts.payor.id, config.accountAccesses.Holder, transaction)) throw new Error("HOLDER_REQUIRED")

        let pap = null
        if (action === "AUTHORIZED") {
            const existing = await Pap.findOne({
                where: { payorId: request.payorId, payeeId: request.payeeId },
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            pap = existing || await Pap.create({
                payorId: request.payorId,
                payeeId: request.payeeId,
                authorizedById: actor.id,
                currency: request.currency,
                weeklyLimit: request.weeklyLimit
            }, { transaction })
            if (existing) {
                await existing.update({
                    authorizedById: actor.id,
                    currency: request.currency,
                    weeklyLimit: request.weeklyLimit,
                    status: "ACTIVE"
                }, { transaction })
            }
        }
        await request.update({
            status: action,
            processorId: actor.id,
            papId: pap?.id || null
        }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: accounts.payor.id,
            action: action === "AUTHORIZED" ? "PAP_AUTHORIZED" : "PAP_REQUEST_DECLINED",
            before: { requestId: request.id, status: "PENDING" },
            after: { requestId: request.id, status: action, papId: pap?.id || null, payeeId: accounts.payee.id }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return { request, pap }
    })
}

export async function revokePap(actor, payor, payee) {
    if (!actor || !payor || !payee) throw new Error("INVALID_PAP")
    return sequelize.transaction(async transaction => {
        const accounts = await lockedAccounts(payor.id, payee.id, transaction)
        const pap = await Pap.findOne({
            where: { payorId: accounts.payor.id, payeeId: accounts.payee.id, status: "ACTIVE" },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!pap) throw new Error("PAP_UNAVAILABLE")
        if (!await canAct(actor, accounts.payor.id, config.accountAccesses.Holder, transaction)
            && !await canAct(actor, accounts.payee.id, config.accountAccesses.Holder, transaction)) {
            throw new Error("HOLDER_REQUIRED")
        }
        await pap.update({ status: "REVOKED" }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: accounts.payor.id,
            action: "PAP_REVOKED",
            before: { papId: pap.id, status: "ACTIVE" },
            after: { papId: pap.id, status: "REVOKED", payeeId: accounts.payee.id }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return pap
    })
}
