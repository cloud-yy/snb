import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AccountAccess, PaymentRequest, PaymentRequestBlock, sequelize } from "#models/models"
import { transfer } from "#functions/db/account"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"

function paymentAmount(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 99999999.99) {
        throw new Error("INVALID_AMOUNT")
    }
    const cents = Math.round(value * 100)
    if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) throw new Error("INVALID_AMOUNT")
    return cents / 100
}

async function hasSignatoryAccess(user, accountId, transaction) {
    return Boolean(user && await AccountAccess.findOne({
        attributes: ["id"],
        where: { userId: user.id, accountId, access: { [Op.gte]: config.accountAccesses.Signatory } },
        transaction
    }))
}

function messageMatches(request, messageId) {
    return !messageId || request.messageIds?.includes(messageId)
}

export async function createPaymentRequest(requester, targetAccount, receivingAccount, rawAmount, currency, reference, { apiAccountId } = {}) {
    const amount = paymentAmount(rawAmount)
    const cleanReference = reference?.trim() || "Payment request"
    if (!requester || !targetAccount || !receivingAccount
        || String(targetAccount.id) === String(receivingAccount.id)
        || !config.currencies.includes(currency) || cleanReference.length > 18) {
        throw new Error("INVALID_PAYMENT_REQUEST")
    }

    return sequelize.transaction(async transaction => {
        const accounts = await Account.findAll({
            attributes: ["id", "name", "number", "type", "status"],
            where: { id: { [Op.in]: [targetAccount.id, receivingAccount.id] } },
            order: [["id", "ASC"]],
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        const target = accounts.find(account => String(account.id) === String(targetAccount.id))
        const receiving = accounts.find(account => String(account.id) === String(receivingAccount.id))
        if (!target || !receiving || target.status !== "ACTIVE" || receiving.status !== "ACTIVE") {
            throw new Error("ACCOUNT_UNAVAILABLE")
        }
        if (apiAccountId && String(receiving.id) !== String(apiAccountId)) throw new Error("ACCOUNT_UNAVAILABLE")
        if (!apiAccountId && !await hasSignatoryAccess(requester, receiving.id, transaction)) {
            throw new Error("SIGNATORY_ACCESS_REQUIRED")
        }

        const blocked = await PaymentRequestBlock.findOne({
            attributes: ["id"],
            where: { blockedAccountId: target.id, requestingAccountId: receiving.id },
            transaction
        })
        if (blocked) throw new Error("PAYMENT_REQUEST_BLOCKED")

        const request = await PaymentRequest.create({
            requesterId: requester.id,
            targetAccountId: target.id,
            receivingAccountId: receiving.id,
            amount,
            currency,
            reference: cleanReference,
            status: "PENDING"
        }, { transaction })
        const auditLog = await requester.createAuditLog({
            accountId: receiving.id,
            action: "PAYMENT_REQUEST_SENT",
            before: null,
            after: { requestId: request.id, targetAccountId: target.id, amount, currency, reference: cleanReference }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return { request, targetAccount: target, receivingAccount: receiving }
    })
}

export async function closePaymentRequest(actor, requestId, messageId, action) {
    if (!actor || !["DENIED", "BLOCKED"].includes(action)) throw new Error("INVALID_PAYMENT_REQUEST")

    return sequelize.transaction(async transaction => {
        const request = await PaymentRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!request || request.status !== "PENDING" || !messageMatches(request, messageId)
            || !await hasSignatoryAccess(actor, request.targetAccountId, transaction)) {
            throw new Error("PAYMENT_REQUEST_UNAVAILABLE")
        }
        if (action === "BLOCKED") {
            await PaymentRequestBlock.findOrCreate({
                where: { blockedAccountId: request.targetAccountId, requestingAccountId: request.receivingAccountId },
                transaction
            })
        }
        await request.update({ status: action }, { transaction })
        const auditLog = await actor.createAuditLog({
            accountId: request.receivingAccountId,
            action: action === "BLOCKED" ? "PAYMENT_REQUEST_BLOCKED" : "PAYMENT_REQUEST_DENIED",
            before: { requestId: request.id, status: "PENDING" },
            after: { requestId: request.id, status: action, targetAccountId: request.targetAccountId }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return request
    })
}

export async function payPaymentRequest(actor, requestId, messageId) {
    if (!actor) throw new Error("INVALID_PAYMENT_REQUEST")

    return sequelize.transaction(async transaction => {
        const request = await PaymentRequest.findByPk(requestId, { transaction, lock: transaction.LOCK.UPDATE })
        if (!request || request.status !== "PENDING" || !messageMatches(request, messageId)
            || !await hasSignatoryAccess(actor, request.targetAccountId, transaction)) {
            throw new Error("PAYMENT_REQUEST_UNAVAILABLE")
        }
        const [payingAccount, receivingAccount] = await Promise.all([
            Account.findByPk(request.targetAccountId, { transaction }),
            Account.findByPk(request.receivingAccountId, { transaction })
        ])
        if (!payingAccount || !receivingAccount) throw new Error("ACCOUNT_UNAVAILABLE")

        const ledger = await transfer(
            payingAccount,
            receivingAccount,
            Number(request.amount),
            request.currency,
            request.reference,
            actor,
            { transaction, ledgerType: "PAYMENT_REQUEST", auditAction: "PAYMENT_REQUEST_ACCEPTED" }
        )
        await request.update({ status: "PAID", payingAccountId: payingAccount.id, ledgerId: ledger.id }, { transaction })
        return { request, ledger, payingAccount, receivingAccount }
    })
}

export async function unblockPaymentRequests(actor, blockedAccount, requestingAccount) {
    if (!actor || !blockedAccount || !requestingAccount) throw new Error("INVALID_PAYMENT_REQUEST")
    if (!await hasSignatoryAccess(actor, blockedAccount.id)) throw new Error("SIGNATORY_ACCESS_REQUIRED")
    const removed = await PaymentRequestBlock.destroy({
        where: { blockedAccountId: blockedAccount.id, requestingAccountId: requestingAccount.id }
    })
    if (!removed) throw new Error("PAYMENT_REQUEST_BLOCK_NOT_FOUND")
    return removed
}
