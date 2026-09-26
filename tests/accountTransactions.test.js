import assert from "node:assert/strict"
import { test } from "node:test"
import { Op } from "sequelize"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"
process.env.DISCORD_GUILD_ID = "main-guild-test"

const { Account, AccountAccess, AuditLog, Ledger, User } = await import("../src/models/models.js")
const { accountTransactionDetails, accountTransactionsPage } = await import("../src/functions/util/accountTransactions.js")
const transactionsInteraction = (await import("../src/interactions/transactions.js")).default
const staffTransactionsInteraction = (await import("../src/interactions/stafftransactions.js")).default

test("transaction pages show outgoing initiators and navigate to older entries", async t => {
    const account = { id: "1", name: "My Account", number: "12345678" }
    const transactions = Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        uuid: `transaction-${index + 1}`,
        payorId: index === 1 ? "2" : "1",
        payeeId: index === 1 ? "1" : "2",
        payor: { name: "Source", number: "11112222" },
        payee: { name: "Destination", number: "33334444" },
        amount: "25.00",
        currency: "HC$",
        reference: "Payment",
        status: "SUCCESS",
        createdAt: new Date("2026-09-26T12:00:00Z")
    }))

    t.mock.method(Ledger, "count", async () => transactions.length)
    t.mock.method(Ledger, "findAll", async options => transactions.slice(options.offset, options.offset + options.limit))
    t.mock.method(AuditLog, "findAll", async () => [{ ledgerId: 1, user: { discordId: "987654321" } }])

    const first = await accountTransactionsPage(account, 0, "123456789")
    const firstEmbed = first.embeds[0].toJSON()
    const firstButtons = first.components[0].toJSON().components

    assert.equal(firstEmbed.fields.length, 5)
    assert.match(firstEmbed.fields[0].value, /Sent by:\*\* <@987654321>/)
    assert.doesNotMatch(firstEmbed.fields[1].value, /Sent by:/)
    assert.match(firstEmbed.footer.text, /Page 1 of 2/)
    assert.equal(firstButtons[0].disabled, true)
    assert.equal(firstButtons[1].custom_id, "transactions_1_123456789_1")

    const second = await accountTransactionsPage(account, 1, "123456789")
    const secondButtons = second.components[0].toJSON().components

    assert.equal(second.embeds[0].toJSON().fields.length, 1)
    assert.equal(secondButtons[0].custom_id, "transactions_1_123456789_0")
    assert.equal(secondButtons[1].disabled, true)
})

test("transaction buttons refuse other users", async () => {
    let response

    await transactionsInteraction.execute({
        isButton: () => true,
        customId: "transactions_1_123456789_1",
        user: { id: "999999999" },
        reply: async payload => { response = payload }
    })

    assert.match(response.embeds[0].toJSON().description, /another customer/)
})

test("specific transaction lookup is scoped to the account and shows its initiator", async t => {
    const account = { id: "1", name: "My Account", number: "12345678" }
    const transaction = {
        id: 7,
        uuid: "00000000-0000-0000-0000-000000000007",
        payorId: "1",
        payeeId: "2",
        payee: { name: "Destination", number: "33334444" },
        amount: "10.00",
        currency: "HC$",
        reference: "Invoice",
        status: "SUCCESS",
        createdAt: new Date("2026-09-26T12:00:00Z")
    }

    t.mock.method(Ledger, "findOne", async options => {
        assert.equal(options.where.uuid, transaction.uuid)
        assert.equal(options.where[Op.or][0].payorId, account.id)
        return transaction
    })
    t.mock.method(AuditLog, "findAll", async () => [{ ledgerId: 7, user: { discordId: "987654321" } }])

    const response = await accountTransactionDetails(account, transaction.uuid)
    const embed = response.embeds[0].toJSON()

    assert.match(embed.fields[0].value, /Sent by:\*\* <@987654321>/)
    assert.doesNotMatch(embed.fields[0].value, /Transaction ID:/)
    assert.equal(embed.footer.text, `Transaction ID: ${transaction.uuid}`)
})

test("staff lookup shows the audit actor for an incoming transaction", async t => {
    const account = { id: "1", name: "Receiving Account", number: "12345678" }
    const transaction = {
        id: 8,
        uuid: "00000000-0000-0000-0000-000000000008",
        payorId: "2",
        payeeId: "1",
        payor: { name: "Source", number: "11112222" },
        amount: "15.00",
        currency: "HC$",
        reference: "Incoming",
        status: "SUCCESS",
        createdAt: new Date("2026-09-26T12:00:00Z")
    }

    t.mock.method(Ledger, "findOne", async () => transaction)
    t.mock.method(AuditLog, "findAll", async () => [{ ledgerId: 8, user: { discordId: "987654321" } }])

    const response = await accountTransactionDetails(account, transaction.uuid, true)

    assert.match(response.embeds[0].toJSON().fields[0].value, /Made by:\*\* <@987654321>/)
})

test("transaction buttons remove history after access is revoked", async t => {
    let response
    let acknowledged = false

    t.mock.method(Account, "findByPk", async () => ({ id: "1", name: "My Account", number: "12345678" }))
    t.mock.method(User, "findOne", async () => ({ id: "2" }))
    t.mock.method(AccountAccess, "findOne", async () => null)
    t.mock.method(Ledger, "count", async () => { throw new Error("History should not be queried") })

    await transactionsInteraction.execute({
        isButton: () => true,
        customId: "transactions_1_123456789_1",
        user: { id: "123456789" },
        deferUpdate: async () => { acknowledged = true },
        editReply: async payload => { response = payload }
    })

    assert.equal(acknowledged, true)
    assert.deepEqual(response.components, [])
    assert.match(response.embeds[0].toJSON().description, /no longer have permission/)
})

test("staff transaction buttons can view any account", async t => {
    let response
    let acknowledged = false

    t.mock.method(Account, "findByPk", async () => ({ id: "1", name: "Any Account", number: "12345678" }))
    t.mock.method(Ledger, "count", async () => 0)
    t.mock.method(Ledger, "findAll", async () => [])

    await staffTransactionsInteraction.execute({
        isButton: () => true,
        customId: "stafftransactions_1_123456789_0",
        user: { id: "123456789" },
        client: {
            guilds: {
                cache: new Map([["main-guild-test", {
                    members: {
                        fetch: async () => ({ roles: { cache: new Map([["1531777851865432154", true]]) } })
                    }
                }]])
            }
        },
        deferUpdate: async () => { acknowledged = true },
        editReply: async payload => { response = payload }
    })

    assert.equal(acknowledged, true)
    assert.match(response.embeds[0].toJSON().description, /no transactions yet/)
})
