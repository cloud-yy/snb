import assert from "node:assert/strict"
import { test } from "node:test"
import config from "../src/config.json" with { type: "json" }

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"
process.env.DISCORD_GUILD_ID = "main-guild-test"

const { User } = await import("../src/models/models.js")
const { default: handler } = await import("../src/interactions/cashrequest.js")

function button(type = "D", action = "complete", staffRole = true, messageId = `${type}-${action}`) {
    const sent = { replies: [], dms: [], edits: [] }
    const currency = Buffer.from("HC$", "utf8").toString("base64url")
    const interaction = {
        customId: `cashrequest_${type}_1_12345_2500_${currency}_${action}`,
        channelId: config.requestChannelId || config.withdrawalChannelId,
        user: { id: "staff-discord" },
        message: {
            id: messageId,
            edit: async payload => { sent.edits.push(payload) }
        },
        client: {
            guilds: { cache: new Map([[process.env.DISCORD_GUILD_ID, {
                members: { fetch: async () => ({
                    roles: { cache: new Map(staffRole ? [[config.staffPermissions.roles.staff, true]] : []) }
                }) }
            }]]) },
            users: { fetch: async id => ({ send: async notification => sent.dms.push({ id, notification }) }) }
        },
        isButton: () => true,
        reply: async response => { sent.replies.push(response) },
        deferReply: async () => {},
        editReply: async response => { sent.replies.push(response) }
    }
    return { interaction, sent }
}

test("cash request buttons reject non-staff members", async () => {
    const { interaction, sent } = button("D", "decline", false)

    await handler.execute(interaction)
    assert.match(sent.replies[0].embeds[0].toJSON().description, /STAFF_ACCESS_REQUIRED/)
    assert.equal(sent.edits.length, 0)
})

for (const [type, action, expectedType, expectedStatus] of [
    ["D", "complete", "DEPOSIT", "COMPLETED"],
    ["W", "decline", "WITHDRAWAL", "DECLINED"]
]) {
    test(`${expectedType.toLowerCase()} requests can be marked ${expectedStatus.toLowerCase()} without request storage`, async t => {
        const { interaction, sent } = button(type, action)
        const staff = { createAuditLog: async entry => { sent.audit = entry; return {} } }
        t.mock.method(User, "findOrCreate", async () => [staff, false])

        await handler.execute(interaction)

        assert.equal(sent.audit.action, `${expectedType}_REQUEST_${expectedStatus}`)
        assert.equal(sent.audit.accountId, "1")
        assert.equal(sent.audit.after.amount, 25)
        assert.equal(sent.edits.length, 1)
        assert.deepEqual(sent.edits[0].components, [])
        assert.match(sent.edits[0].embeds[0].toJSON().description, /No money was moved/)
        assert.equal(sent.dms[0].id, "12345")
    })
}
