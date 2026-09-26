import assert from "node:assert/strict"
import { test } from "node:test"
import config from "../src/config.json" with { type: "json" }

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Account, AccountAccess, sequelize } = await import("../src/models/models.js")
const { setAccountAccess } = await import("../src/functions/db/account.js")

test("account access changes retain the configured role limit", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    const limit = config.accounts.Business.access.Signatory
    const existingAccesses = Array.from({ length: limit }, (_, index) => ({
        id: String(index + 1),
        userId: String(index + 10),
        access: config.accountAccesses.Signatory
    }))

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async () => ({ id: "1", type: "Business", status: "ACTIVE" }))
    t.mock.method(AccountAccess, "findAll", async () => existingAccesses)

    await assert.rejects(
        setAccountAccess(
            { id: "1" },
            { id: "99" },
            { id: "1" },
            config.accountAccesses.Signatory
        ),
        { message: "ACCOUNT_ACCESS_LIMIT_REACHED" }
    )
})
