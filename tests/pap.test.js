import assert from "node:assert/strict"
import { test } from "node:test"
import { Op } from "sequelize"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Account, AccountAccess, Pap, PapRequest, Ledger, sequelize } = await import("../src/models/models.js")
const {
    authorizePap, collectPap, createPapRequest,
    editPap, respondToPapRequest, revokePap
} = await import("../src/functions/db/pap.js")
const { default: notifyPapRequest } = await import("../src/functions/util/notifyPapRequest.js")

const transaction = { LOCK: { UPDATE: "UPDATE" } }
const actor = { id: "5", createAuditLog: async entry => ({ id: "1", ...entry }) }
const payer = { id: "1", name: "Payer", number: "11112222", type: "General", status: "ACTIVE" }
const business = { id: "2", name: "Business", number: "22223333", type: "Business", status: "ACTIVE" }

function mockPair(t) {
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findAll", async () => [payer, business])
}

test("PAP models and ledger use the renamed schema", () => {
    assert.equal(Pap.tableName, "paps")
    assert.equal(PapRequest.tableName, "papRequests")
    assert.ok(PapRequest.rawAttributes.papId)
    assert.ok(Ledger.rawAttributes.papId)
    assert.equal(Ledger.associations.pap.target, Pap)
})

test("a Holder authorizes one PAP between two accounts with only a weekly limit", async t => {
    mockPair(t)
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.accountId, payer.id)
        return { id: "7" }
    })
    t.mock.method(Pap, "findOne", async () => null)
    t.mock.method(Pap, "create", async values => ({ id: "9", status: "ACTIVE", ...values }))

    const pap = await authorizePap(actor, payer, business, "HC$", 50)
    assert.equal(pap.payorId, payer.id)
    assert.equal(pap.payeeId, business.id)
    assert.equal(pap.weeklyLimit, 50)
    assert.equal("maxAmount" in pap, false)
    assert.equal("totalLimit" in pap, false)
})

test("a collection addressed by payer account number enforces the weekly limit", async t => {
    const pap = { id: "9", payorId: "1", payeeId: "2", status: "ACTIVE", currency: "HC$", weeklyLimit: "50.00" }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findOne", async options => {
        assert.equal(options.where.number, "11112222")
        return payer
    })
    t.mock.method(Pap, "findOne", async options => {
        assert.deepEqual(options.where, { payorId: "1", payeeId: "2", status: "ACTIVE" })
        return pap
    })
    t.mock.method(Account, "findByPk", async () => business)
    t.mock.method(Ledger, "sum", async (_field, options) => {
        assert.equal(options.where.papId, "9")
        assert.ok(options.where.createdAt[Op.gte] instanceof Date)
        return "45.00"
    })

    await assert.rejects(
        collectPap(actor, "11112222", business, 10, "Invoice", { apiPayeeId: business.id }),
        { message: "PAP_WEEKLY_LIMIT_EXCEEDED" }
    )
})

test("the payer Holder can edit the weekly limit and revoke the account pair", async t => {
    const pap = {
        id: "9", payorId: "1", payeeId: "2", status: "ACTIVE", weeklyLimit: "50.00",
        update: async values => Object.assign(pap, values)
    }
    mockPair(t)
    t.mock.method(AccountAccess, "findOne", async () => ({ id: "7" }))
    t.mock.method(Pap, "findOne", async () => pap)

    await editPap(actor, payer, business, 75)
    assert.equal(pap.weeklyLimit, 75)
    await revokePap(actor, payer, business)
    assert.equal(pap.status, "REVOKED")
})

test("a business request becomes the PAP for the same account pair", async t => {
    const request = {
        id: "7", payorId: "1", payeeId: "2", requestedById: "5", status: "PENDING",
        currency: "HC$", weeklyLimit: "50.00", reference: "Membership",
        update: async values => Object.assign(request, values)
    }
    mockPair(t)
    t.mock.method(AccountAccess, "findOne", async options => {
        const expectedAccess = options.where.accountId === business.id ? 10 : 20
        assert.equal(options.where.access[Op.gte], expectedAccess)
        return { id: "20" }
    })
    t.mock.method(Pap, "findOne", async () => null)
    t.mock.method(PapRequest, "findOne", async () => null)
    t.mock.method(PapRequest, "create", async values => Object.assign(request, values))

    const created = await createPapRequest(actor, payer, business, "HC$", 50, "Membership")
    assert.equal(created.request.status, "PENDING")

    t.mock.method(PapRequest, "findByPk", async () => request)
    t.mock.method(Pap, "create", async values => ({ id: "9", status: "ACTIVE", ...values }))

    const result = await respondToPapRequest(actor, "7", "AUTHORIZED")
    assert.equal(result.pap.id, "9")
    assert.equal(request.status, "AUTHORIZED")
    assert.equal(request.papId, "9")
})

test("a non-signatory cannot request a PAP for a business", async t => {
    mockPair(t)
    t.mock.method(AccountAccess, "findOne", async () => null)
    await assert.rejects(createPapRequest(actor, payer, business, "HC$", 50, "Membership"), {
        message: "BUSINESS_ACCESS_REQUIRED"
    })
})

test("a PAP request stops pending when no Holder can be notified", async () => {
    const request = {
        id: "7", status: "PENDING", currency: "HC$", weeklyLimit: 50, reference: "Membership",
        update: async values => Object.assign(request, values)
    }
    const payor = { ...payer, getUsers: async () => [{ discordId: "holder-1" }] }
    const client = { users: { fetch: async () => ({ send: async () => { throw new Error("DM closed") } }) } }

    const delivered = await notifyPapRequest(client, { request, payor, payee: business })
    assert.equal(delivered, 0)
    assert.equal(request.status, "DELIVERY_FAILED")
})
