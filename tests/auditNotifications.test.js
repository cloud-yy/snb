import assert from "node:assert/strict"
import { test } from "node:test"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { AuditLog } = await import("../src/models/models.js")
const {
    configureAuditLogNotifications,
    queueAuditLogNotification
} = await import("../src/functions/util/auditLogNotifications.js")

test("audit channel posts are queued until the staff change commits", async t => {
    let afterCommit
    let sentPayload
    let resolveDelivery
    const delivered = new Promise(resolve => { resolveDelivery = resolve })
    const transaction = {
        afterCommit: callback => { afterCommit = callback }
    }

    t.mock.method(AuditLog, "findByPk", async () => ({
        id: "1",
        action: "ACCOUNT_FROZEN",
        before: { status: "ACTIVE" },
        after: { status: "FROZEN", reason: "Security review" },
        accountId: "2",
        userId: "3",
        ledgerId: null,
        createdAt: new Date("2026-09-26T12:00:00Z"),
        account: { name: "Test Account", number: "12345678" },
        user: { discordId: "987654321" }
    }))

    configureAuditLogNotifications({
        channels: {
            fetch: async channelId => {
                assert.equal(channelId, "1553367619162210414")
                return {
                    isTextBased: () => true,
                    send: async payload => {
                        sentPayload = payload
                        resolveDelivery()
                    }
                }
            }
        }
    })

    queueAuditLogNotification({ id: "1" }, transaction)

    assert.equal(sentPayload, undefined)
    assert.equal(typeof afterCommit, "function")

    afterCommit()
    await delivered

    const embed = sentPayload.embeds[0].toJSON()

    assert.equal(embed.title, "Account frozen")
    assert.match(embed.fields[0].value, /Made by:\*\* <@987654321>/)
    assert.match(embed.fields[0].value, /Security review/)
})
