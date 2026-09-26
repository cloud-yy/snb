import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import {
    Account, AccountAccess, PaymentRequest, PaymentRequestBlock, sequelize
} from "#models/models"
import { transfer } from "#functions/db/account"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"

function paymentAmount(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 99999999.99) {
        throw new Error("INVALID_AMOUNT")
    }
    const cents = Math.round(value * 100)
    if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 0.000001) {
        throw new Error("INVALID_AMOUNT")
    }
    return cents / 100
}

export async function createPaymentRequest(requester, target, receivingAccount, rawAmount, currency, reference) {
    const amount = paymentAmount(rawAmount)
    const cleanReference = reference?.trim() || "Payment request"
    if (!requester || !target || !receivingAccount || String(requester.id) === String(target.id)
        || !config.currencies.includes(currency) || cleanReference.length > 18) {
        throw new Error("INVALID_PAYMENT_REQUEST")
    }

    return sequelize.transaction(async transaction => {
        const account = await Account.findByPk(receivingAccount.id, {
            attributes: ["id", "name", "number", "type", "status"],
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!account || account.status !== "ACTIVE") throw new Error("ACCOUNT_UNAVAILABLE")

        const access = await AccountAccess.findOne({
            attributes: ["id"],
            where: {
                userId: requester.id,
                accountId: account.id,
                access: { [Op.gte]: config.accountAccesses.Signatory }
            },
            transaction
        })
        if (!access) throw new Error("SIGNATORY_ACCESS_REQUIRED")

        const blocked = await PaymentRequestBlock.findOne({
            attributes: ["id"],
            where: { blockedUserId: target.id, requestingAccountId: account.id },
            transaction
        })
        if (blocked) throw new Error("PAYMENT_REQUEST_BLOCKED")

        const request = await PaymentRequest.create({
            requesterId: requester.id,
            targetId: target.id,
            receivingAccountId: account.id,
            amount,
            currency,
            reference: cleanReference,
            status: "PENDING"
        }, { transaction })
        const auditLog = await requester.createAuditLog({
            accountId: account.id,
            action: "PAYMENT_REQUEST_SENT",
            before: null,
            after: { requestId: request.id, targetId: target.id, amount, currency, reference: cleanReference }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return request
    })
}

export async function closePaymentRequest(target, requestId, messageId, action) {
    if (!target || !["DENIED", "BLOCKED"].includes(action)) throw new Error("INVALID_PAYMENT_REQUEST")

    return sequelize.transaction(async transaction => {
        const request = await PaymentRequest.findByPk(requestId, {
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!request || request.status !== "PENDING" || String(request.targetId) !== String(target.id)
            || request.messageId !== messageId) {
            throw new Error("PAYMENT_REQUEST_UNAVAILABLE")
        }

        if (action === "BLOCKED") {
            await Account.findByPk(request.receivingAccountId, {
                attributes: ["id"],
                transaction,
                lock: transaction.LOCK.UPDATE
            })
            await PaymentRequestBlock.findOrCreate({
                where: {
                    blockedUserId: target.id,
                    requestingAccountId: request.receivingAccountId
                },
                transaction
            })
        }
        await request.update({ status: action }, { transaction })
        const auditLog = await target.createAuditLog({
            accountId: request.receivingAccountId,
            action: action === "BLOCKED" ? "PAYMENT_REQUEST_BLOCKED" : "PAYMENT_REQUEST_DENIED",
            before: { requestId: request.id, status: "PENDING" },
            after: { requestId: request.id, status: action }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
        return request
    })
}

export async function payPaymentRequest(target, requestId, messageId, payingAccountId) {
    if (!target || !payingAccountId) throw new Error("INVALID_PAYMENT_REQUEST")

    return sequelize.transaction(async transaction => {
        const request = await PaymentRequest.findByPk(requestId, {
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!request || request.status !== "PENDING" || String(request.targetId) !== String(target.id)
            || request.messageId !== messageId) {
            throw new Error("PAYMENT_REQUEST_UNAVAILABLE")
        }

        const [payingAccount, receivingAccount] = await Promise.all([
            Account.findByPk(payingAccountId, { transaction }),
            Account.findByPk(request.receivingAccountId, { transaction })
        ])
        if (!payingAccount || !receivingAccount) throw new Error("ACCOUNT_UNAVAILABLE")

        const ledger = await transfer(
            payingAccount,
            receivingAccount,
            Number(request.amount),
            request.currency,
            request.reference,
            target,
            {
                transaction,
                ledgerType: "PAYMENT_REQUEST",
                auditAction: "PAYMENT_REQUEST_ACCEPTED",
                authorize: async () => {
                    const access = await AccountAccess.findOne({
                        attributes: ["id"],
                        where: {
                            userId: target.id,
                            accountId: payingAccount.id,
                            access: { [Op.gte]: config.accountAccesses.Signatory }
                        },
                        transaction
                    })
                    if (!access) throw new Error("SIGNATORY_ACCESS_REQUIRED")
                }
            }
        )
        await request.update({
            status: "PAID",
            payingAccountId: payingAccount.id,
            ledgerId: ledger.id
        }, { transaction })

        return { request, ledger, payingAccount, receivingAccount }
    })
}

export async function unblockPaymentRequests(target, requestingAccount) {
    if (!target || !requestingAccount) throw new Error("INVALID_PAYMENT_REQUEST")
    const removed = await PaymentRequestBlock.destroy({
        where: { blockedUserId: target.id, requestingAccountId: requestingAccount.id }
    })
    if (!removed) throw new Error("PAYMENT_REQUEST_BLOCK_NOT_FOUND")
    return removed
}
