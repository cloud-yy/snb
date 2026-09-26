import assert from "node:assert/strict"
import { test } from "node:test"
import config from "../src/config.json" with { type: "json" }

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"
process.env.DISCORD_GUILD_ID = "main-guild-test"

const { Account, AccountBalance, Ledger, User, Withdrawal, sequelize } = await import("../src/models/models.js")
const { default: handler } = await import("../src/interactions/withdraw.js")

function button(action = "complete", staffRole = true) {
    const sent = { replies: [], dms: [], deleted: false }
    const interaction = {
        customId: `withdraw_9_${action}`,
        channelId: config.withdrawalChannelId,
        user: { id: "staff-discord" },
        message: {
            id: "request-message",
            delete: async () => { sent.deleted = true }
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

test("withdrawal buttons reject non-staff members", async () => {
    const { interaction, sent } = button("cancel", false)
    await handler.execute(interaction)
    assert.match(sent.replies[0].embeds[0].data.description, /STAFF_ACCESS_REQUIRED/)
    assert.equal(sent.deleted, false)
})

test("staff can cancel a pending withdrawal and notify the customer", async t => {
    const { interaction, sent } = button("cancel")
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    const staff = { id: "5", createAuditLog: async entry => { sent.audit = entry } }
    const request = {
        id: "9", requesterId: "10", accountId: "1", amount: "25.00", status: "PENDING", messageId: "request-message",
        update: async values => Object.assign(request, values)
    }

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(User, "findOrCreate", async () => [staff, false])
    t.mock.method(User, "findByPk", async () => ({ discordId: "customer-discord" }))
    t.mock.method(Withdrawal, "findByPk", async () => request)

    await handler.execute(interaction)

    assert.equal(request.status, "CANCELLED")
    assert.equal(sent.deleted, true)
    assert.equal(sent.audit.action, "WITHDRAWAL_CANCELLED")
    assert.equal(sent.dms.length, 1)
    assert.match(sent.dms[0].embeds[0].data.description, /cancelled/)
})

test("staff completion moves funds once and records a withdrawal ledger", async t => {
    const { interaction, sent } = button()
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    const staff = { id: "5", createAuditLog: async entry => { sent.audit = entry } }
    const request = {
        id: "9", requesterId: "10", accountId: "1", amount: "25.00", status: "PENDING", messageId: "request-message",
        update: async values => Object.assign(request, values)
    }
    const balances = new Map([
        ["1", { id: "11", balance: "100.00" }],
        ["2", { id: "12", balance: "50.00" }]
    ])
    for (const balance of balances.values()) {
        balance.increment = async (_field, options) => { balance.balance = String(Number(balance.balance) + options.by) }
        balance.reload = async () => balance
    }

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(User, "findOrCreate", async () => [staff, false])
    t.mock.method(User, "findByPk", async () => ({ discordId: "customer-discord" }))
    t.mock.method(Withdrawal, "findByPk", async () => request)
    t.mock.method(Account, "findOne", async () => ({ id: "2", status: "ACTIVE" }))
    t.mock.method(Account, "findByPk", async () => ({ id: "1" }))
    t.mock.method(Account, "findAll", async () => [{ id: "1", status: "ACTIVE" }, { id: "2", status: "ACTIVE" }])
    t.mock.method(AccountBalance, "findOrCreate", async () => [])
    t.mock.method(AccountBalance, "findOne", async options => balances.get(String(options.where.accountId)))
    t.mock.method(Ledger, "create", async values => {
        sent.ledger = values
        return { id: "20", uuid: "transaction-uuid", ...values }
    })

    await handler.execute(interaction)

    assert.equal(request.status, "COMPLETED")
    assert.equal(request.ledgerId, "20")
    assert.equal(Number(balances.get("1").balance), 75)
    assert.equal(Number(balances.get("2").balance), 75)
    assert.equal(sent.ledger.type, "WITHDRAWAL")
    assert.equal(sent.ledger.currency, "HC$")
    assert.equal(sent.audit.action, "WITHDRAWAL_COMPLETED")
    assert.equal(sent.deleted, true)
    assert.equal(sent.dms.length, 1)

    const again = button()
    await handler.execute(again.interaction)
    assert.match(again.sent.replies.at(-1).embeds[0].data.description, /WITHDRAWAL_ALREADY_HANDLED/)
    assert.equal(again.sent.deleted, false)
})
