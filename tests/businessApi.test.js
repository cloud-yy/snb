import assert from "node:assert/strict"
import { test } from "node:test"
import express from "express"
import { Op } from "sequelize"
import config from "../src/config.json" with { type: "json" }

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const {
    Account, AccountAccess, BusinessApiKey, Pap, PapRequest, Ledger,
    PaymentRequest, PaymentRequestBlock, User, sequelize
} = await import("../src/models/models.js")
const {
    accountForBusinessApiKey,
    businessApiKeyPrefix,
    hashBusinessApiKey,
    issueBusinessApiKey
} = await import("../src/functions/db/businessApiKey.js")
const { default: businessApiRouter } = await import("../src/routes/api/account.js")
const exampleApiKey = `${businessApiKeyPrefix()}_example`

test("a business manager can rotate an API key while only its hash is stored", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" }, afterCommit: () => {} }
    const storedKey = { update: async values => Object.assign(storedKey, values) }
    let auditEntry
    const actor = {
        id: "5",
        createAuditLog: async entry => { auditEntry = entry; return {} }
    }

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async (_id, options) => {
        assert.equal(options.lock, transaction.LOCK.UPDATE)
        return { id: "1", type: "Business", status: "ACTIVE" }
    })
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.access[Op.gte], 15)
        return { id: "7" }
    })
    t.mock.method(BusinessApiKey, "findOrCreate", async options => {
        assert.deepEqual(options.where, { accountId: "1" })
        return [storedKey, false]
    })

    const apiKey = await issueBusinessApiKey(actor, { id: "1" })

    assert.equal(apiKey.startsWith(`${businessApiKeyPrefix()}_`), true)
    assert.equal(businessApiKeyPrefix(), config.branding.abbreviation.toLowerCase().replace(/[^a-z0-9]/g, ""))
    assert.equal(storedKey.keyHash, hashBusinessApiKey(apiKey))
    assert.notEqual(storedKey.keyHash, apiKey)
    assert.equal(storedKey.createdById, "5")
    assert.equal(auditEntry.action, "BUSINESS_API_KEY_ISSUED")
    assert.equal(auditEntry.after.rotated, true)
})

test("a business signatory cannot issue an API key", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async () => ({ id: "1", type: "Business", status: "ACTIVE" }))
    t.mock.method(AccountAccess, "findOne", async () => null)

    await assert.rejects(issueBusinessApiKey({ id: "5" }, { id: "1" }), { message: "MANAGER_ACCESS_REQUIRED" })
})

test("an API key resolves its business account without exposing the raw key", async t => {
    const account = { id: "1", type: "Business" }
    const storedKey = {
        account,
        creator: { id: "5", discordId: "12345" },
        update: async values => Object.assign(storedKey, values)
    }
    t.mock.method(BusinessApiKey, "findOne", async options => {
        assert.equal(options.where.keyHash, hashBusinessApiKey(exampleApiKey))
        return storedKey
    })

    assert.equal(await accountForBusinessApiKey(exampleApiKey), account)
    assert.ok(storedKey.lastUsedAt instanceof Date)
    assert.equal(await accountForBusinessApiKey("invalid"), null)
})

test("business API endpoints return account info, balances, and transactions", async t => {
    const account = {
        id: "1",
        name: "Example Ltd",
        number: "12345678",
        type: "Business",
        status: "ACTIVE",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-09-01T00:00:00Z"),
        getAccountBalances: async () => [{ currency: "HC$", balance: "125.50" }]
    }
    const storedKey = { account, creator: { id: "5", discordId: "12345" }, update: async () => {} }
    t.mock.method(BusinessApiKey, "findOne", async () => storedKey)
    t.mock.method(Ledger, "count", async () => 1)
    t.mock.method(Ledger, "findAll", async () => [{
        uuid: "00000000-0000-0000-0000-000000000001",
        payorId: "1",
        payeeId: "2",
        payee: { id: "2", name: "Supplier", number: "87654321" },
        amount: "20.00",
        currency: "HC$",
        reference: "Invoice",
        status: "SUCCESS",
        type: "TRANSFER",
        createdAt: new Date("2026-09-20T12:00:00Z")
    }])

    const app = express()
    app.use(businessApiRouter)
    const server = await new Promise(resolve => {
        const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer))
    })
    t.after(() => new Promise(resolve => server.close(resolve)))
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/account/12345678`
    const headers = { Authorization: `Bearer ${exampleApiKey}` }

    const [infoResponse, balanceResponse, transactionsResponse] = await Promise.all([
        fetch(`${baseUrl}/info`, { headers }),
        fetch(`${baseUrl}/balance`, { headers }),
        fetch(`${baseUrl}/transactions`, { headers })
    ])
    const [info, balance, transactions] = await Promise.all([
        infoResponse.json(), balanceResponse.json(), transactionsResponse.json()
    ])

    assert.equal(info.account.name, "Example Ltd")
    assert.equal(info.account.number, "12345678")
    assert.equal("id" in info.account, false)
    assert.equal(balance.accountNumber, "12345678")
    assert.deepEqual(balance.balances, [{ currency: "HC$", balance: "125.50" }])
    assert.equal(transactions.accountNumber, "12345678")
    assert.equal(transactions.transactions[0].direction, "outgoing")
    assert.equal(transactions.transactions[0].counterparty.name, "Supplier")
    assert.equal("id" in transactions.transactions[0].counterparty, false)
    assert.deepEqual(transactions.pagination, { total: 1, limit: 25, offset: 0 })

    const oldIdResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/account/1/info`, { headers })
    assert.equal(oldIdResponse.status, 403)
})

test("the API can request payer authorization for a PAP", async t => {
    const actor = { id: "5", discordId: "12345", createAuditLog: async entry => ({ id: "20", ...entry }) }
    const payee = { id: "2", name: "Example Ltd", number: "22223333", type: "Business", status: "ACTIVE" }
    const payor = {
        id: "1", name: "Customer", number: "11112222", type: "General", status: "ACTIVE",
        getUsers: async () => [{ discordId: "customer-discord" }]
    }
    const papRequest = {
        id: "7", status: "PENDING", currency: "HC$", weeklyLimit: 50, reference: "Membership",
        update: async values => Object.assign(papRequest, values)
    }
    const sent = []

    t.mock.method(BusinessApiKey, "findOne", async () => ({ account: payee, creator: actor, update: async () => {} }))
    t.mock.method(Account, "findOne", async options => {
        assert.equal(options.where.number, payor.number)
        return payor
    })
    t.mock.method(Account, "findAll", async () => [payor, payee])
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.accountId, payee.id)
        return { id: "10" }
    })
    t.mock.method(Pap, "findOne", async () => null)
    t.mock.method(PapRequest, "findOne", async () => null)
    t.mock.method(PapRequest, "create", async values => Object.assign(papRequest, values))
    t.mock.method(sequelize, "transaction", async callback => callback({ LOCK: { UPDATE: "UPDATE" }, afterCommit: callback => callback() }))

    const app = express()
    app.locals.discordClient = {
        users: { fetch: async () => ({ send: async payload => { sent.push(payload); return { id: "dm-1" } } }) }
    }
    app.use(express.json())
    app.use(businessApiRouter)
    const server = await new Promise(resolve => {
        const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer))
    })
    t.after(() => new Promise(resolve => server.close(resolve)))

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/22223333/paps/requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${exampleApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            payorAccountNumber: "11112222", currency: "HC$", weeklyLimit: 50, reference: "Membership"
        })
    })
    const body = await response.json()

    assert.equal(response.status, 202)
    assert.equal(body.request.id, "7")
    assert.equal(body.notificationsDelivered, 1)
    assert.equal(sent[0].components[0].components[0].data.custom_id, "paprequest_7_accept")

    const oldBodyResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/account/22223333/paps/requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${exampleApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ payorAccountId: "1", currency: "HC$", weeklyLimit: 50, reference: "Membership" })
    })
    assert.equal(oldBodyResponse.status, 400)
})

test("the API can send a normal payment request", async t => {
    const actor = { id: "5", discordId: "12345", createAuditLog: async entry => ({ id: "20", ...entry }) }
    const account = { id: "2", name: "Example Ltd", number: "22223333", type: "Business", status: "ACTIVE" }
    const target = {
        id: "9", name: "Customer", number: "11112222", status: "ACTIVE",
        getUsers: async () => [{ discordId: "customer-discord" }]
    }
    const paymentRequest = {
        id: "8", status: "PENDING", currency: "HC$", amount: "15.00", reference: "Invoice",
        update: async values => Object.assign(paymentRequest, values)
    }
    const sent = []

    t.mock.method(BusinessApiKey, "findOne", async () => ({ account, creator: actor, update: async () => {} }))
    t.mock.method(Account, "findOne", async options => {
        assert.equal(options.where.number, target.number)
        return target
    })
    t.mock.method(Account, "findAll", async () => [account, target])
    t.mock.method(PaymentRequestBlock, "findOne", async () => null)
    t.mock.method(PaymentRequest, "create", async values => Object.assign(paymentRequest, values))
    t.mock.method(PaymentRequest, "findOne", async options => {
        assert.equal(options.where.receivingAccountId, account.id)
        assert.ok(options.include.some(include => include.as === "targetAccount"))
        return { ...paymentRequest, targetAccount: target, ledger: null }
    })
    t.mock.method(sequelize, "transaction", async callback => callback({ LOCK: { UPDATE: "UPDATE" }, afterCommit: callback => callback() }))

    const app = express()
    app.locals.discordClient = {
        users: { fetch: async () => ({ send: async payload => { sent.push(payload); return { id: "dm-2" } } }) }
    }
    app.use(express.json())
    app.use(businessApiRouter)
    const server = await new Promise(resolve => {
        const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer))
    })
    t.after(() => new Promise(resolve => server.close(resolve)))

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/22223333/payment-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${exampleApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ targetAccountNumber: "11112222", amount: 15, currency: "HC$", reference: "Invoice" })
    })
    const body = await response.json()

    assert.equal(response.status, 202)
    assert.equal(body.request.id, "8")
    assert.deepEqual(paymentRequest.messageIds, ["dm-2"])
    assert.equal(sent[0].components[0].components[0].data.custom_id, "request_8_accept")

    const detailResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/account/22223333/payment-requests/8`, {
        headers: { Authorization: `Bearer ${exampleApiKey}` }
    })
    const detail = await detailResponse.json()
    assert.equal(detailResponse.status, 200)
    assert.equal(detail.request.targetAccountNumber, "11112222")
    assert.equal("targetAccountId" in detail.request, false)

    const oldBodyResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/account/22223333/payment-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${exampleApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ targetAccountId: "9", amount: 15, currency: "HC$", reference: "Invoice" })
    })
    assert.equal(oldBodyResponse.status, 400)
})

test("the API can check a PAP and its remaining limits", async t => {
    const account = { id: "2", number: "22223333", type: "Business" }
    const actor = { id: "5", discordId: "12345" }
    t.mock.method(BusinessApiKey, "findOne", async () => ({ account, creator: actor, update: async () => {} }))
    t.mock.method(Pap, "findOne", async () => ({
        id: "9",
        payor: { id: "1", name: "Customer", number: "11112222", status: "ACTIVE" },
        status: "ACTIVE",
        currency: "HC$",
        weeklyLimit: "50.00",
    }))
    t.mock.method(Ledger, "sum", async () => "15.00")

    const app = express()
    app.use(businessApiRouter)
    const server = await new Promise(resolve => {
        const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer))
    })
    t.after(() => new Promise(resolve => server.close(resolve)))

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/account/22223333/paps/11112222`, {
        headers: { Authorization: `Bearer ${exampleApiKey}` }
    })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.pap.payer.number, "11112222")
    assert.equal(body.pap.remainingWeekly, "35.00")
})
