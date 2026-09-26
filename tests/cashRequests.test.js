import assert from "node:assert/strict"
import { test } from "node:test"
import config from "../src/config.json" with { type: "json" }

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"
process.env.DISCORD_GUILD_ID = "main-guild-test"

const { User, Withdrawal, sequelize } = await import("../src/models/models.js")
const { default: handler } = await import("../src/interactions/cashrequest.js")

function button(action = "complete", staffRole = true) {
    const sent = { replies: [], dms: [], edits: [] }
    const interaction = {
        customId: `cashrequest_9_${action}`,
        channelId: config.requestChannelId || config.withdrawalChannelId,
        user: { id: "staff-discord" },
        message: {
            id: "request-message",
            edit: async payload => { sent.edits.push(payload) }
        },
        client: {
            guilds: { cache: new Map([[process.env.DISCORD_GUILD_ID, {
                members: { fetch: async () => ({
                    roles: { cache: new Map(staffRole ? [[config.staffPermissions.roles.staff, true]] : []) }
                }) }
            }]]) },
            users: { fetch: async () => ({ send: async notification => sent.dms.push(notification) }) }
        },
        isButton: () => true,
        reply: async response => { sent.replies.push(response) },
        deferReply: async () => {},
        editReply: async response => { sent.replies.push(response) }
    }
    return { interaction, sent }
}

test("cash request buttons reject non-staff members", async t => {
    const { interaction, sent } = button("decline", false)
    t.mock.method(Withdrawal, "findByPk", async () => ({ id: "9", type: "DEPOSIT" }))

    await handler.execute(interaction)
    assert.match(sent.replies[0].embeds[0].toJSON().description, /STAFF_ACCESS_REQUIRED/)
    assert.equal(sent.edits.length, 0)
})

for (const [type, action, expectedStatus] of [
    ["DEPOSIT", "complete", "COMPLETED"],
    ["WITHDRAWAL", "decline", "DECLINED"]
]) {
    test(`${type.toLowerCase()} requests can be marked ${expectedStatus.toLowerCase()} without moving money`, async t => {
        const { interaction, sent } = button(action)
        const transaction = { LOCK: { UPDATE: "UPDATE" } }
        const staff = { id: "5", createAuditLog: async entry => { sent.audit = entry; return {} } }
        const request = {
            id: "9", requesterId: "10", accountId: "1", amount: "25.00", currency: "HC$",
            type, status: "PENDING", messageId: "request-message",
            update: async values => Object.assign(request, values)
        }

        t.mock.method(sequelize, "transaction", async callback => callback(transaction))
        t.mock.method(User, "findOrCreate", async () => [staff, false])
        t.mock.method(User, "findByPk", async () => ({ discordId: "customer-discord" }))
        t.mock.method(Withdrawal, "findByPk", async (_id, options) => {
            if (options?.lock) assert.equal(options.lock, transaction.LOCK.UPDATE)
            return request
        })

        await handler.execute(interaction)

        assert.equal(request.status, expectedStatus)
        assert.equal(request.ledgerId, undefined)
        assert.equal(sent.audit.action, `${type}_REQUEST_${expectedStatus}`)
        assert.equal(sent.edits.length, 1)
        assert.deepEqual(sent.edits[0].components, [])
        assert.match(sent.edits[0].embeds[0].toJSON().description, /No money was moved/)
        assert.equal(sent.dms.length, 1)
    })
}
