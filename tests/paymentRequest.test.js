import assert from "node:assert/strict"
import { test } from "node:test"
import { Op } from "sequelize"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const {
    Account, AccountAccess, AccountBalance, Ledger, PaymentRequest, PaymentRequestBlock, sequelize
} = await import("../src/models/models.js")
const {
    closePaymentRequest, createPaymentRequest, payPaymentRequest
} = await import("../src/functions/db/paymentRequest.js")

const transaction = { LOCK: { UPDATE: "UPDATE" } }
const requester = { id: "5" }
const target = { id: "6", status: "ACTIVE", createAuditLog: async () => ({}) }

test("a blocked account cannot send another payment request", async t => {
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findAll", async () => [{ id: "1", status: "ACTIVE" }, target])
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.access[Op.gte], 10)
        return { id: "2" }
    })
    t.mock.method(PaymentRequestBlock, "findOne", async options => {
        assert.deepEqual(options.where, { blockedAccountId: "6", requestingAccountId: "1" })
        return { id: "3" }
    })
    t.mock.method(PaymentRequest, "create", async () => { throw new Error("SHOULD_NOT_CREATE") })

    await assert.rejects(
        createPaymentRequest(requester, target, { id: "1" }, 25, "HC$", "Invoice"),
        { message: "PAYMENT_REQUEST_BLOCKED" }
    )
})

test("sending a request records an account audit event", async t => {
    let auditEntry
    const auditingRequester = {
        id: "5",
        createAuditLog: async entry => { auditEntry = entry; return {} }
    }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findAll", async () => [{ id: "1", status: "ACTIVE" }, target])
    t.mock.method(AccountAccess, "findOne", async () => ({ id: "2" }))
    t.mock.method(PaymentRequestBlock, "findOne", async () => null)
    t.mock.method(PaymentRequest, "create", async values => ({ id: "9", ...values }))

    const { request } = await createPaymentRequest(auditingRequester, target, { id: "1" }, 25, "HC$", "  Invoice  ")

    assert.equal(request.reference, "Invoice")
    assert.equal(auditEntry.action, "PAYMENT_REQUEST_SENT")
    assert.equal(auditEntry.accountId, "1")
    assert.equal(auditEntry.after.requestId, "9")
})

test("blocking a request closes it and records an account block", async t => {
    const request = {
        id: "9",
        targetAccountId: "6",
        receivingAccountId: "1",
        status: "PENDING",
        messageIds: ["message-1"],
        update: async values => Object.assign(request, values)
    }
    let blockWhere
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(PaymentRequest, "findByPk", async (_id, options) => {
        assert.equal(options.lock, transaction.LOCK.UPDATE)
        return request
    })
    t.mock.method(AccountAccess, "findOne", async () => ({ id: "4" }))
    t.mock.method(PaymentRequestBlock, "findOrCreate", async options => {
        blockWhere = options.where
        return [{ id: "3" }, true]
    })

    await closePaymentRequest(target, "9", "message-1", "BLOCKED")

    assert.equal(request.status, "BLOCKED")
    assert.deepEqual(blockWhere, { blockedAccountId: "6", requestingAccountId: "1" })
})

test("accepting a request pays it once and records the selected account", async t => {
    const request = {
        id: "9",
        requesterId: "5",
        targetAccountId: "1",
        receivingAccountId: "2",
        amount: "25.00",
        currency: "HC$",
        reference: "Invoice",
        status: "PENDING",
        messageIds: ["message-1"],
        update: async values => Object.assign(request, values)
    }
    const paying = { id: "1", name: "Paying", number: "11112222", status: "ACTIVE", type: "General" }
    const receiving = { id: "2", name: "Receiving", number: "33334444", status: "ACTIVE", type: "Business" }
    const balances = {
        "1": { id: "11", balance: 100, increment: async (_field, options) => { balances["1"].balance += options.by }, reload: async () => {} },
        "2": { id: "12", balance: 0, increment: async (_field, options) => { balances["2"].balance += options.by } }
    }
    let ledgerCreates = 0

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(PaymentRequest, "findByPk", async () => request)
    t.mock.method(Account, "findByPk", async id => String(id) === "1" ? paying : receiving)
    t.mock.method(Account, "findAll", async () => [paying, receiving])
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.userId, "6")
        assert.equal(options.where.accountId, "1")
        return { id: "4" }
    })
    t.mock.method(AccountBalance, "findOrCreate", async () => [])
    t.mock.method(AccountBalance, "findOne", async options => balances[String(options.where.accountId)])
    t.mock.method(Ledger, "create", async values => {
        ledgerCreates++
        assert.equal(values.type, "PAYMENT_REQUEST")
        return { id: "20", uuid: "transaction-id", ...values }
    })

    const result = await payPaymentRequest({ id: "6", createAuditLog: async () => ({}) }, "9", "message-1")
    assert.equal(result.request.status, "PAID")
    assert.equal(result.request.payingAccountId, "1")
    assert.equal(result.request.ledgerId, "20")
    assert.equal(balances["1"].balance, 75)
    assert.equal(balances["2"].balance, 25)

    await assert.rejects(payPaymentRequest({ id: "6" }, "9", "message-1"), { message: "PAYMENT_REQUEST_UNAVAILABLE" })
    assert.equal(ledgerCreates, 1)
})
