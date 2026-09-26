import assert from "node:assert/strict"
import { test } from "node:test"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"
process.env.DISCORD_GUILD_ID = "main-guild-test"

const { Account, AccountAccess, AuditLog, User } = await import("../src/models/models.js")
const { auditLogPage } = await import("../src/functions/util/auditLogs.js")
const auditInteraction = (await import("../src/interactions/audit.js")).default
const staffAuditInteraction = (await import("../src/interactions/staffaudit.js")).default

test("account audit pages show the actor, reason, and pagination", async t => {
    const log = {
        id: 1,
        action: "ACCOUNT_FROZEN",
        before: { status: "ACTIVE" },
        after: { status: "FROZEN", reason: "Security review" },
        accountId: "1",
        userId: "2",
        ledgerId: null,
        createdAt: new Date("2026-09-26T12:00:00Z"),
        user: { discordId: "987654321" }
    }

    t.mock.method(AuditLog, "count", async () => 6)
    t.mock.method(AuditLog, "findAll", async options => {
        assert.equal(options.offset, 0)
        return [log]
    })

    const response = await auditLogPage({
        where: { accountId: "1" },
        requestedPage: 0,
        buttonBase: "audit_account_1_123456789",
        title: "Account audit logs",
        description: "Recorded activity.",
        footer: "Account: 1234 5678",
        showActor: true,
        showAccount: false
    })
    const embed = response.embeds[0].toJSON()
    const buttons = response.components[0].toJSON().components

    assert.match(embed.fields[0].value, /Made by:\*\* <@987654321>/)
    assert.match(embed.fields[0].value, /ACTIVE → FROZEN/)
    assert.match(embed.fields[0].value, /Security review/)
    assert.match(embed.footer.text, /Page 1 of 2/)
    assert.equal(buttons[1].custom_id, "audit_account_1_123456789_1")
})

test("account audit buttons remove logs after viewer access is revoked", async t => {
    let response

    t.mock.method(User, "findOne", async () => ({ id: "2" }))
    t.mock.method(Account, "findByPk", async () => ({ id: "1", name: "Account", number: "12345678" }))
    t.mock.method(AccountAccess, "findOne", async () => null)
    t.mock.method(AuditLog, "count", async () => { throw new Error("Logs should not be queried") })

    await auditInteraction.execute({
        isButton: () => true,
        customId: "audit_account_1_123456789_1",
        user: { id: "123456789" },
        deferUpdate: async () => {},
        editReply: async payload => { response = payload }
    })

    assert.deepEqual(response.components, [])
    assert.match(response.embeds[0].toJSON().description, /no longer have permission/)
})

test("personal audit buttons cannot be reused for another profile", async t => {
    let response

    t.mock.method(User, "findOne", async () => ({ id: "99" }))

    await auditInteraction.execute({
        isButton: () => true,
        customId: "audit_user_2_123456789_1",
        user: { id: "123456789" },
        deferUpdate: async () => {},
        editReply: async payload => { response = payload }
    })

    assert.deepEqual(response.components, [])
    assert.match(response.embeds[0].toJSON().description, /no longer view/)
})

test("staff audit buttons require the configured main-guild role", async () => {
    let response

    await staffAuditInteraction.execute({
        isButton: () => true,
        customId: "staffaudit_account_1_123456789_1",
        user: { id: "123456789" },
        client: {
            guilds: {
                cache: new Map([["main-guild-test", {
                    members: { fetch: async () => ({ roles: { cache: new Map() } }) }
                }]])
            }
        },
        reply: async payload => { response = payload }
    })

    assert.match(response.embeds[0].toJSON().description, /only available to the staff member/)
})
