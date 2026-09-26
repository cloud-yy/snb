import { Router } from "express"
import { Op } from "sequelize"
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"
import config from "#config" with { type: "json" }
import { Account, Ledger, PaymentRequest } from "#models/models"
import { businessApiContextForKey } from "#functions/db/businessApiKey"
import {
    collectPap, createPapRequest, papForPayee, papRequestForPayee
} from "#functions/db/pap"
import { createPaymentRequest } from "#functions/db/paymentRequest"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import notifyOutgoingPap from "#functions/util/notifyOutgoingPap"
import notifyPapRequest from "#functions/util/notifyPapRequest"
import message from "#functions/templates/message"

const router = Router()

function bearerToken(request) {
    const authorization = request.get("authorization")
    const match = /^Bearer\s+([A-Za-z0-9]+_[A-Za-z0-9_-]+)$/.exec(authorization || "")
    return match?.[1] || null
}

function jsonError(response, status, code, message) {
    return response.status(status).json({ error: { code, message } })
}

function operationError(response, error) {
    const errors = {
        INVALID_AMOUNT: [400, "Enter a positive amount with no more than two decimal places."],
        INVALID_COLLECTION: [400, "Provide a valid amount and a reference of up to 18 characters."],
        INVALID_PAP: [400, "Provide a valid payer, currency, weekly limit, and reference."],
        INVALID_PAYMENT_REQUEST: [400, "Provide a valid paying account, amount, currency, and reference."],
        ACCOUNT_UNAVAILABLE: [404, "The requested account is unavailable."],
        PAP_UNAVAILABLE: [404, "The PAP was not found or is inactive."],
        PAP_REQUEST_UNAVAILABLE: [404, "The PAP request was not found."],
        BUSINESS_ACCESS_REQUIRED: [403, "Signatory access to the collecting business account is required."],
        PAYMENT_REQUEST_BLOCKED: [403, "The paying account has blocked payment requests from this account."],
        PAP_REQUEST_PENDING: [409, "A matching PAP request is already pending."],
        PAP_EXISTS: [409, "An active PAP already exists between these accounts."],
        PAP_WEEKLY_LIMIT_EXCEEDED: [422, "The collection exceeds the PAP's remaining weekly limit."],
        REQUEST_NOT_DELIVERED: [422, "No Signatory of the paying account could be notified."],
        INSUFFICIENT_FUNDS: [422, "The paying account has insufficient funds."],
        ACCOUNT_FROZEN: [422, "One of the accounts is frozen."],
        ACCOUNT_CLOSED: [422, "One of the accounts is closed."]
    }
    const [status, description] = errors[error?.message] || [500, "The API operation could not be completed."]
    if (status === 500) console.error("Business API operation failed:", error)
    return jsonError(response, status, error?.message || "API_OPERATION_FAILED", description)
}

router.use("/api/account/:businessAccountNumber", async (request, response, next) => {
    response.set("Cache-Control", "no-store")

    try {
        const context = await businessApiContextForKey(bearerToken(request))
        if (!context) return jsonError(response, 401, "INVALID_API_KEY", "A valid Bearer API key is required.")
        if (!/^\d+$/.test(request.params.businessAccountNumber)
            || String(context.account.number) !== request.params.businessAccountNumber) {
            return jsonError(response, 403, "ACCOUNT_ACCESS_DENIED", "This API key cannot access that account.")
        }

        response.locals.businessAccount = context.account
        response.locals.apiActor = context.actor
        return next()
    } catch (error) {
        console.error("Business API authentication failed:", error)
        return jsonError(response, 500, "API_UNAVAILABLE", "The API is temporarily unavailable.")
    }
})

router.get("/api/account/:businessAccountNumber/info", (request, response) => {
    const account = response.locals.businessAccount
    return response.json({
        account: {
            name: account.name,
            number: account.number,
            type: account.type,
            status: account.status,
            createdAt: account.createdAt,
            updatedAt: account.updatedAt
        }
    })
})

router.get("/api/account/:businessAccountNumber/balance", async (request, response) => {
    try {
        const account = response.locals.businessAccount
        const balances = await account.getAccountBalances({
            attributes: ["currency", "balance"],
            order: [["currency", "ASC"]]
        })
        return response.json({
            accountNumber: account.number,
            balances: balances.map(balance => ({
                currency: balance.currency,
                balance: String(balance.balance)
            }))
        })
    } catch (error) {
        console.error("Business API balance request failed:", error)
        return jsonError(response, 500, "API_UNAVAILABLE", "The account balance could not be loaded.")
    }
})

router.get("/api/account/:businessAccountNumber/transactions", async (request, response) => {
    try {
        const account = response.locals.businessAccount
        const requestedLimit = Number.parseInt(request.query.limit, 10)
        const requestedOffset = Number.parseInt(request.query.offset, 10)
        const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 25
        const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000) : 0
        const where = { [Op.or]: [{ payorId: account.id }, { payeeId: account.id }] }
        const [total, transactions] = await Promise.all([
            Ledger.count({ where }),
            Ledger.findAll({
                attributes: ["uuid", "payorId", "payeeId", "amount", "currency", "reference", "status", "type", "createdAt"],
                where,
                include: [
                    { model: Account, as: "payor", attributes: ["id", "name", "number"] },
                    { model: Account, as: "payee", attributes: ["id", "name", "number"] }
                ],
                order: [["createdAt", "DESC"], ["id", "DESC"]],
                limit,
                offset
            })
        ])

        return response.json({
            accountNumber: account.number,
            transactions: transactions.map(transaction => {
                const outgoing = String(transaction.payorId) === String(account.id)
                const counterparty = outgoing ? transaction.payee : transaction.payor
                return {
                    id: transaction.uuid,
                    direction: outgoing ? "outgoing" : "incoming",
                    amount: String(transaction.amount),
                    currency: transaction.currency,
                    reference: transaction.reference,
                    status: transaction.status,
                    type: transaction.type,
                    counterparty: counterparty ? {
                        name: counterparty.name,
                        number: counterparty.number
                    } : null,
                    createdAt: transaction.createdAt
                }
            }),
            pagination: { total, limit, offset }
        })
    } catch (error) {
        console.error("Business API transaction request failed:", error)
        return jsonError(response, 500, "API_UNAVAILABLE", "Account transactions could not be loaded.")
    }
})

router.get("/api/account/:businessAccountNumber/paps/requests/:requestId", async (request, response) => {
    try {
        const account = response.locals.businessAccount
        const papRequest = await papRequestForPayee(account.id, request.params.requestId)
        return response.json({
            request: {
                id: String(papRequest.id),
                status: papRequest.status,
                papId: papRequest.papId ? String(papRequest.papId) : null,
                payer: {
                    name: papRequest.payor.name,
                    number: papRequest.payor.number
                },
                currency: papRequest.currency,
                weeklyLimit: String(papRequest.weeklyLimit),
                reference: papRequest.reference,
                createdAt: papRequest.createdAt,
                updatedAt: papRequest.updatedAt
            }
        })
    } catch (error) {
        return operationError(response, error)
    }
})

router.post("/api/account/:businessAccountNumber/paps/requests", async (request, response) => {
    try {
        const payee = response.locals.businessAccount
        const actor = response.locals.apiActor
        const payorAccountNumber = request.body?.payorAccountNumber
        const payor = typeof payorAccountNumber === "string" && /^\d+$/.test(payorAccountNumber)
            ? await Account.findOne({ where: { number: payorAccountNumber }, attributes: ["id", "name", "number", "type", "status"] })
            : null
        const result = await createPapRequest(
            actor, payor, payee,
            request.body?.currency,
            request.body?.weeklyLimit,
            request.body?.reference
        )

        const client = request.app.locals.discordClient
        const delivered = await notifyPapRequest(client, result)
        if (!delivered) {
            return jsonError(response, 422, "REQUEST_NOT_DELIVERED", "No account Holder could be notified.")
        }

        return response.status(202).json({
            request: { id: String(result.request.id), status: result.request.status },
            notificationsDelivered: delivered
        })
    } catch (error) {
        return operationError(response, error)
    }
})

router.get("/api/account/:businessAccountNumber/paps/:payerAccountNumber", async (request, response) => {
    try {
        const account = response.locals.businessAccount
        const { pap, collectedThisWeek } = await papForPayee(account.id, request.params.payerAccountNumber)
        return response.json({
            pap: {
                status: pap.status,
                payer: {
                    name: pap.payor.name,
                    number: pap.payor.number,
                    status: pap.payor.status
                },
                currency: pap.currency,
                weeklyLimit: String(pap.weeklyLimit),
                collectedThisWeek: collectedThisWeek.toFixed(2),
                remainingWeekly: Math.max(0, Number(pap.weeklyLimit) - collectedThisWeek).toFixed(2)
            }
        })
    } catch (error) {
        return operationError(response, error)
    }
})

router.post("/api/account/:businessAccountNumber/paps/:payerAccountNumber/take", async (request, response) => {
    try {
        const payee = response.locals.businessAccount
        const actor = response.locals.apiActor
        const result = await collectPap(
            actor,
            request.params.payerAccountNumber,
            payee,
            request.body?.amount,
            request.body?.reference,
            { apiPayeeId: payee.id }
        )
        const client = request.app.locals.discordClient
        void notifyIncomingPayment(client, result.payee, {
            amount: result.ledger.amount,
            currency: result.ledger.currency,
            reference: result.ledger.reference,
            transactionId: result.ledger.uuid
        })
        void notifyOutgoingPap(client, result.payor, result.payee, result.ledger)
        return response.json({
            transaction: {
                id: result.ledger.uuid,
                amount: String(result.ledger.amount),
                currency: result.ledger.currency,
                reference: result.ledger.reference,
                status: result.ledger.status
            },
            payerAccountNumber: result.payor.number
        })
    } catch (error) {
        return operationError(response, error)
    }
})

router.get("/api/account/:businessAccountNumber/payment-requests/:requestId", async (request, response) => {
    try {
        const paymentRequest = await PaymentRequest.findOne({
            attributes: ["id", "amount", "currency", "reference", "status", "ledgerId", "createdAt", "updatedAt"],
            where: { id: request.params.requestId, receivingAccountId: response.locals.businessAccount.id },
            include: [
                { model: Ledger, attributes: ["uuid"] },
                { model: Account, as: "targetAccount", attributes: ["number"] }
            ]
        })
        if (!paymentRequest) throw new Error("PAYMENT_REQUEST_UNAVAILABLE")
        return response.json({
            request: {
                id: String(paymentRequest.id),
                status: paymentRequest.status,
                targetAccountNumber: paymentRequest.targetAccount.number,
                amount: String(paymentRequest.amount),
                currency: paymentRequest.currency,
                reference: paymentRequest.reference,
                transactionId: paymentRequest.ledger?.uuid || null,
                createdAt: paymentRequest.createdAt,
                updatedAt: paymentRequest.updatedAt
            }
        })
    } catch (error) {
        if (error?.message === "PAYMENT_REQUEST_UNAVAILABLE") {
            return jsonError(response, 404, error.message, "The payment request was not found.")
        }
        return operationError(response, error)
    }
})

router.post("/api/account/:businessAccountNumber/payment-requests", async (request, response) => {
    let paymentRequest
    try {
        const account = response.locals.businessAccount
        const actor = response.locals.apiActor
        const targetAccountNumber = request.body?.targetAccountNumber
        const target = typeof targetAccountNumber === "string" && /^\d+$/.test(targetAccountNumber)
            ? await Account.findOne({ where: { number: targetAccountNumber }, attributes: ["id", "name", "number", "type", "status"] })
            : null
        const result = await createPaymentRequest(
            actor,
            target,
            account,
            request.body?.amount,
            request.body?.currency,
            request.body?.reference,
            { apiAccountId: account.id }
        )
        paymentRequest = result.request
        const notification = {
            ...message(
                "Payment requested",
                `**From:** ${account.name} (${formatAccountNumber(account.number)})\n**Paying account:** ${result.targetAccount.name} (${formatAccountNumber(result.targetAccount.number)})\n**Amount:** ${paymentRequest.currency} ${formatCurrency(paymentRequest.amount)}\n**Reference:** ${paymentRequest.reference}\n\nAccept to pay from the named account. Blocking stops this account from sending it more payment requests.`,
                undefined,
                `Request #${paymentRequest.id}`
            ),
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`request_${paymentRequest.id}_accept`).setLabel("Accept").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`request_${paymentRequest.id}_deny`).setLabel("Deny").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`request_${paymentRequest.id}_block`).setLabel("Block account").setStyle(ButtonStyle.Danger)
            )],
            allowedMentions: { parse: [] }
        }
        const signatories = await result.targetAccount.getUsers({
            attributes: ["discordId"],
            through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Signatory } } }
        })
        const deliveries = await Promise.allSettled(signatories
            .filter(signatory => signatory.discordId)
            .map(async signatory => (await request.app.locals.discordClient.users.fetch(signatory.discordId)).send(notification)))
        const messageIds = deliveries.filter(delivery => delivery.status === "fulfilled").map(delivery => delivery.value.id)
        if (!messageIds.length) throw new Error("REQUEST_NOT_DELIVERED")
        await paymentRequest.update({ messageIds })
        return response.status(202).json({
            request: { id: String(paymentRequest.id), status: paymentRequest.status }
        })
    } catch (error) {
        if (paymentRequest) await paymentRequest.update({ status: "CANCELLED" }).catch(console.error)
        return operationError(response, error)
    }
})

export default router
