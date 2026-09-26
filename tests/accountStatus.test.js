import assert from "node:assert/strict"
import { test } from "node:test"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Account, sequelize } = await import("../src/models/models.js")
const { setAccountStatus } = await import("../src/functions/db/account.js")

test("staff can move a closed account to active and the change is audited", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    const lockedAccount = {
        status: "CLOSED",
        update: async values => { lockedAccount.status = values.status }
    }
    let auditEntry

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async (id, options) => {
        assert.equal(id, "1")
        assert.equal(options.lock, transaction.LOCK.UPDATE)
        return lockedAccount
    })

    await setAccountStatus({
        createAuditLog: async entry => { auditEntry = entry }
    }, { id: "1" }, "ACTIVE", "  Customer request  ")

    assert.equal(lockedAccount.status, "ACTIVE")
    assert.deepEqual(auditEntry, {
        accountId: "1",
        action: "ACCOUNT_ACTIVE",
        before: { status: "CLOSED" },
        after: { status: "ACTIVE", reason: "Customer request" }
    })
})

test("setting the existing account status is rejected", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } }

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async () => ({ status: "FROZEN" }))

    await assert.rejects(
        setAccountStatus({ createAuditLog: async () => {} }, { id: "1" }, "FROZEN", "Review"),
        { message: "ACCOUNT_ALREADY_FROZEN" }
    )
})
