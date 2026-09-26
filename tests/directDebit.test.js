import assert from "node:assert/strict"
import { test } from "node:test"
import { Op } from "sequelize"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Account, AccountAccess, AccountBalance, DirectDebit, Ledger, sequelize } = await import("../src/models/models.js")
const { authorizeDirectDebit, collectDirectDebit, revokeDirectDebit } = await import("../src/functions/db/directDebit.js")
const { currentWeekStart } = await import("../src/functions/util/accountActivity.js")

const transaction = { LOCK: { UPDATE: "UPDATE" } }
const actor = { id: "5", createAuditLog: async () => ({ id: 1 }) }

test("only a payer holder can authorize a business mandate with a weekly limit", async t => {
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findAll", async () => [
        { id: "1", type: "General", status: "ACTIVE" },
        { id: "2", type: "Business", status: "ACTIVE" }
    ])
    t.mock.method(AccountAccess, "findOne", async () => null)
    t.mock.method(DirectDebit, "create", async () => { throw new Error("SHOULD_NOT_CREATE") })

    await assert.rejects(
        authorizeDirectDebit(actor, { id: "1" }, { id: "2" }, "HC$", 10, 50, 100),
        { message: "HOLDER_REQUIRED" }
    )
    await assert.rejects(
        authorizeDirectDebit(actor, { id: "1" }, { id: "2" }, "HC$", 10, 5, 100),
        { message: "INVALID_MANDATE" }
    )
})

test("personal and reserve accounts cannot collect direct debits", async t => {
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findAll", async () => [
        { id: "1", type: "Business", status: "ACTIVE" },
        { id: "2", type: "General", status: "ACTIVE" }
    ])
    t.mock.method(DirectDebit, "create", async () => { throw new Error("SHOULD_NOT_CREATE") })

    await assert.rejects(
        authorizeDirectDebit(actor, { id: "1" }, { id: "2" }, "HC$", 10, 50),
        { message: "BUSINESS_ACCOUNT_REQUIRED" }
    )
})

test("collection is refused once the current weekly allowance would be exceeded", async t => {
    const mandate = {
        id: "9", payorId: "1", payeeId: "2", status: "ACTIVE", currency: "HC$",
        maxAmount: "20.00", weeklyLimit: "50.00", totalLimit: "200.00", totalCollected: "40.00"
    }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(DirectDebit, "findByPk", async (id, options) => {
        assert.equal(id, "9")
        assert.equal(options.lock, transaction.LOCK.UPDATE)
        return mandate
    })
    t.mock.method(Account, "findByPk", async id => ({ id, type: id === "2" ? "Enterprize" : "General" }))
    t.mock.method(Ledger, "sum", async (field, options) => {
        assert.equal(field, "amount")
        assert.equal(options.where.directDebitId, "9")
        assert.equal(options.where.status, "SUCCESS")
        assert.ok(options.where.createdAt[Op.gte] >= currentWeekStart(Date.now() - 5000))
        assert.equal(options.transaction, transaction)
        return "45.00"
    })
    t.mock.method(Ledger, "create", async () => { throw new Error("SHOULD_NOT_TRANSFER") })

    await assert.rejects(collectDirectDebit(actor, "9", 10, "Invoice"), { message: "MANDATE_WEEKLY_LIMIT_EXCEEDED" })
})

test("a recurring mandate can have a weekly cap without a lifetime cap", async t => {
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findAll", async () => [
        { id: "1", type: "General", status: "ACTIVE" },
        { id: "2", type: "Business", status: "ACTIVE" }
    ])
    t.mock.method(AccountAccess, "findOne", async () => ({ id: "7" }))
    t.mock.method(DirectDebit, "create", async values => ({ id: "9", ...values }))

    const mandate = await authorizeDirectDebit(actor, { id: "1" }, { id: "2" }, "HC$", 10, 50)
    assert.equal(mandate.weeklyLimit, 50)
    assert.equal(mandate.totalLimit, null)
})

test("revoking a mandate stops future collections", async t => {
    const mandate = {
        id: "9", payorId: "1", payeeId: "2", status: "ACTIVE",
        update: async values => { mandate.status = values.status }
    }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(DirectDebit, "findByPk", async () => mandate)
    t.mock.method(AccountAccess, "findOne", async () => ({ id: "3" }))

    await revokeDirectDebit(actor, "9")
    assert.equal(mandate.status, "REVOKED")
    await assert.rejects(collectDirectDebit(actor, "9", 1, "Invoice"), { message: "MANDATE_UNAVAILABLE" })
})

test("an authorized collection links the ledger and updates the mandate total", async t => {
    let collected = 0
    let audit
    const mandate = {
        id: "9", payorId: "1", payeeId: "2", status: "ACTIVE", currency: "HC$",
        maxAmount: "20.00", weeklyLimit: "50.00", totalLimit: "200.00", totalCollected: "40.00",
        increment: async (field, options) => {
            assert.equal(field, "totalCollected")
            collected += options.by
        }
    }
    const payor = { id: "1", type: "General", status: "ACTIVE" }
    const payee = { id: "2", type: "Business", status: "ACTIVE" }
    const balances = {
        "1": { id: "11", balance: 100, increment: async () => {}, reload: async () => {} },
        "2": { id: "12", balance: 0, increment: async () => {} }
    }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(DirectDebit, "findByPk", async () => mandate)
    t.mock.method(Account, "findByPk", async id => id === "1" ? payor : payee)
    t.mock.method(Account, "findAll", async () => [payor, payee])
    t.mock.method(AccountAccess, "findOne", async () => ({ id: "7" }))
    t.mock.method(AccountBalance, "findOrCreate", async () => [])
    t.mock.method(AccountBalance, "findOne", async options => balances[options.where.accountId])
    t.mock.method(Ledger, "sum", async () => "10.00")
    t.mock.method(Ledger, "create", async values => {
        assert.equal(values.type, "DIRECT_DEBIT")
        assert.equal(values.directDebitId, "9")
        assert.equal(values.amount, 12)
        return { id: "20", uuid: "payment-id", ...values }
    })
    const result = await collectDirectDebit({
        id: "5", createAuditLog: async entry => { audit = entry; return {} }
    }, "9", 12, "  Invoice  ")

    assert.equal(result.ledger.reference, "Invoice")
    assert.equal(collected, 12)
    assert.equal(audit.action, "DIRECT_DEBIT_COLLECTED")
    assert.equal(audit.accountId, "1")
})

test("a collector without business Signatory access cannot debit the payer", async t => {
    const payor = { id: "1", type: "General", status: "ACTIVE" }
    const payee = { id: "2", type: "Enterprize", status: "ACTIVE" }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(DirectDebit, "findByPk", async () => ({
        id: "9", payorId: "1", payeeId: "2", status: "ACTIVE", currency: "HC$",
        maxAmount: "20.00", weeklyLimit: "50.00", totalLimit: null, totalCollected: "0.00"
    }))
    t.mock.method(Account, "findByPk", async id => id === "1" ? payor : payee)
    t.mock.method(Account, "findAll", async () => [payor, payee])
    t.mock.method(AccountAccess, "findOne", async () => null)
    t.mock.method(Ledger, "sum", async () => 0)
    t.mock.method(AccountBalance, "findOrCreate", async () => { throw new Error("SHOULD_NOT_MOVE_MONEY") })

    await assert.rejects(collectDirectDebit(actor, "9", 10, "Invoice"), { message: "BUSINESS_ACCESS_REQUIRED" })
})

test("a mandate cannot be collected if its payee is no longer a business account", async t => {
    const payor = { id: "1", type: "General", status: "ACTIVE" }
    const payee = { id: "2", type: "Reserve", status: "ACTIVE" }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(DirectDebit, "findByPk", async () => ({
        id: "9", payorId: "1", payeeId: "2", status: "ACTIVE", currency: "HC$",
        maxAmount: "20.00", weeklyLimit: "50.00", totalLimit: null, totalCollected: "0.00"
    }))
    t.mock.method(Account, "findByPk", async id => id === "1" ? payor : payee)
    t.mock.method(Account, "findAll", async () => [payor, payee])
    t.mock.method(Ledger, "sum", async () => 0)
    t.mock.method(AccountBalance, "findOrCreate", async () => { throw new Error("SHOULD_NOT_MOVE_MONEY") })

    await assert.rejects(collectDirectDebit(actor, "9", 10, "Invoice"), { message: "BUSINESS_ACCOUNT_REQUIRED" })
})
