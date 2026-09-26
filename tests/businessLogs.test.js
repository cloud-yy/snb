import assert from "node:assert/strict"
import { test } from "node:test"
import { Op } from "sequelize"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Account, AccountAccess, BusinessLog, Ledger, sequelize } = await import("../src/models/models.js")
const { setBusinessLogChannel } = await import("../src/functions/db/businessLog.js")
const {
    configureBusinessLogNotifications,
    queueBusinessTransactionNotification
} = await import("../src/functions/util/businessLogNotifications.js")

test("a business manager can configure a server transaction log channel", async t => {
    let auditEntry
    const transaction = {
        LOCK: { UPDATE: "UPDATE" },
        afterCommit: () => {}
    }
    const settings = {
        auditChannelId: null,
        transactionChannelId: null,
        update: async values => Object.assign(settings, values)
    }
    const actor = {
        id: "5",
        createAuditLog: async entry => { auditEntry = entry; return { id: "8", accountId: entry.accountId } }
    }

    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async (_id, options) => {
        assert.equal(options.lock, transaction.LOCK.UPDATE)
        return { id: "1", type: "Business", status: "ACTIVE" }
    })
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.access[Op.gte], 15)
        return { access: 15 }
    })
    t.mock.method(BusinessLog, "findOrCreate", async options => {
        assert.deepEqual(options.where, { accountId: "1", guildId: "guild-1" })
        return [settings, false]
    })

    await setBusinessLogChannel(actor, { id: "1" }, "guild-1", "transactions", "channel-1")

    assert.equal(settings.transactionChannelId, "channel-1")
    assert.equal(auditEntry.action, "BUSINESS_LOG_CHANNEL_UPDATED")
    assert.deepEqual(auditEntry.after, {
        kind: "transactions",
        guildId: "guild-1",
        channelId: "channel-1"
    })
})

test("personal accounts cannot configure business log channels", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async () => ({ id: "1", type: "General", status: "ACTIVE" }))
    t.mock.method(AccountAccess, "findOne", async () => { throw new Error("SHOULD_NOT_CHECK_ACCESS") })

    await assert.rejects(
        setBusinessLogChannel({ id: "5" }, { id: "1" }, "guild-1", "audits", "channel-1"),
        { message: "BUSINESS_ACCOUNT_REQUIRED" }
    )
})

test("business signatories cannot configure server log channels", async t => {
    const transaction = { LOCK: { UPDATE: "UPDATE" } }
    t.mock.method(sequelize, "transaction", async callback => callback(transaction))
    t.mock.method(Account, "findByPk", async () => ({ id: "1", type: "Business", status: "ACTIVE" }))
    t.mock.method(AccountAccess, "findOne", async options => {
        assert.equal(options.where.access[Op.gte], 15)
        return null
    })

    await assert.rejects(
        setBusinessLogChannel({ id: "5" }, { id: "1" }, "guild-1", "audits", "channel-1"),
        { message: "MANAGER_ACCESS_REQUIRED" }
    )
})

test("incoming and outgoing transaction logs are sent after commit", async t => {
    let afterCommit
    const sent = []
    let resolveDelivery
    const delivered = new Promise(resolve => { resolveDelivery = resolve })

    configureBusinessLogNotifications({
        channels: {
            fetch: async channelId => ({
                isTextBased: () => true,
                send: async payload => {
                    sent.push({ channelId, payload })
                    if (sent.length === 2) resolveDelivery()
                }
            })
        }
    })
    t.after(() => configureBusinessLogNotifications(null))

    t.mock.method(Ledger, "findByPk", async () => ({
        id: "9",
        uuid: "00000000-0000-0000-0000-000000000009",
        payorId: "1",
        payeeId: "2",
        payor: { name: "Seller", number: "11112222" },
        payee: { name: "Buyer", number: "33334444" },
        amount: "25.00",
        currency: "HC$",
        reference: "Invoice",
        status: "SUCCESS",
        type: "TRANSFER",
        createdAt: new Date("2026-09-26T12:00:00Z")
    }))
    t.mock.method(BusinessLog, "findAll", async options => {
        assert.deepEqual(options.where.accountId[Op.in], ["1", "2"])
        return [
            { accountId: "1", transactionChannelId: "outgoing-channel" },
            { accountId: "2", transactionChannelId: "incoming-channel" }
        ]
    })

    queueBusinessTransactionNotification({ id: "9" }, {
        afterCommit: callback => { afterCommit = callback }
    })
    assert.equal(sent.length, 0)
    assert.equal(typeof afterCommit, "function")

    afterCommit()
    await delivered

    assert.equal(sent.length, 2)
    assert.equal(sent[0].payload.embeds[0].toJSON().title, "Outgoing transaction")
    assert.equal(sent[1].payload.embeds[0].toJSON().title, "Incoming transaction")
    assert.match(sent[0].payload.embeds[0].toJSON().description, /Invoice/)
})
