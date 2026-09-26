import assert from "node:assert/strict"
import { test } from "node:test"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { AuditLog, BusinessLog } = await import("../src/models/models.js")
const {
    configureAuditLogNotifications,
    queueAuditLogNotification
} = await import("../src/functions/util/auditLogNotifications.js")

test("audit channel posts are queued until the staff change commits", async t => {
    let afterCommit
    const sentPayloads = []
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
    t.mock.method(BusinessLog, "findAll", async () => [{ auditChannelId: "business-audit-channel" }])

    configureAuditLogNotifications({
        channels: {
            fetch: async channelId => {
                assert.ok(["1553367619162210414", "business-audit-channel"].includes(channelId))
                return {
                    isTextBased: () => true,
                    send: async payload => {
                        sentPayloads.push({ channelId, payload })
                        if (sentPayloads.length === 2) resolveDelivery()
                    }
                }
            }
        }
    })
    t.after(() => configureAuditLogNotifications(null))

    queueAuditLogNotification({ id: "1", accountId: "2" }, transaction, { central: true })

    assert.equal(sentPayloads.length, 0)
    assert.equal(typeof afterCommit, "function")

    afterCommit()
    await delivered

    const embed = sentPayloads[0].payload.embeds[0].toJSON()

    assert.deepEqual(sentPayloads.map(delivery => delivery.channelId).sort(), ["1553367619162210414", "business-audit-channel"].sort())
    assert.equal(embed.title, "Account frozen")
    assert.match(embed.fields[0].value, /Made by:\*\* <@987654321>/)
    assert.match(embed.fields[0].value, /Security review/)
})

test("business actions do not post to the central audit channel", async t => {
    let afterCommit
    const fetchedChannels = []
    let resolveDelivery
    const delivered = new Promise(resolve => { resolveDelivery = resolve })

    t.mock.method(AuditLog, "findByPk", async () => ({
        id: "2",
        action: "BUSINESS_LOG_CHANNEL_UPDATED",
        before: { kind: "audits", channelId: null },
        after: { kind: "audits", channelId: "business-audit-channel" },
        accountId: "2",
        userId: "3",
        ledgerId: null,
        createdAt: new Date("2026-09-26T12:00:00Z"),
        account: { name: "Business Account", number: "12345678" },
        user: { discordId: "987654321" }
    }))
    t.mock.method(BusinessLog, "findAll", async () => [{ auditChannelId: "business-audit-channel" }])

    configureAuditLogNotifications({
        channels: {
            fetch: async channelId => {
                fetchedChannels.push(channelId)
                return {
                    isTextBased: () => true,
                    send: async () => resolveDelivery()
                }
            }
        }
    })
    t.after(() => configureAuditLogNotifications(null))

    queueAuditLogNotification({ id: "2", accountId: "2" }, {
        afterCommit: callback => { afterCommit = callback }
    })
    afterCommit()
    await delivered

    assert.deepEqual(fetchedChannels, ["business-audit-channel"])
})
