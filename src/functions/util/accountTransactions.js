import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"
import { Op } from "sequelize"
import { Account, AuditLog, Ledger, User } from "#models/models"
import message from "#functions/templates/message"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"

const PAGE_SIZE = 5

async function transactionInitiators(transactions, account, includeIncoming = false) {
    const outgoingIds = transactions
        .filter(transaction => includeIncoming || String(transaction.payorId) === String(account.id))
        .map(transaction => transaction.id)
    const auditLogs = outgoingIds.length
        ? await AuditLog.findAll({
            attributes: ["ledgerId", "userId"],
            where: {
                ledgerId: { [Op.in]: outgoingIds },
                action: { [Op.in]: ["TRANSFER", "WITHDRAWAL_COMPLETED"] }
            },
            include: [{ model: User, attributes: ["discordId", "robloxName"] }]
        })
        : []

    return new Map(auditLogs.map(log => [String(log.ledgerId), log.user]))
}

function transactionField(transaction, account, initiator, includeId = true, showInitiatorForAll = false) {
    const outgoing = String(transaction.payorId) === String(account.id)
    const otherAccount = outgoing ? transaction.payee : transaction.payor
    const otherName = otherAccount?.name?.slice(0, 100) || "Account unavailable"
    const otherNumber = otherAccount?.number ? formatAccountNumber(otherAccount.number) : "Unavailable"
    const date = Math.floor(transaction.createdAt.getTime() / 1000)
    const details = [
        `**${outgoing ? "To" : "From"}:** ${otherName} (${otherNumber})`,
        `**Date:** <t:${date}:f>`,
        `**Reference:** ${transaction.reference}`,
        (outgoing || showInitiatorForAll) && `**${showInitiatorForAll ? "Made by" : "Sent by"}:** ${initiator?.discordId ? `<@${initiator.discordId}>` : "Unavailable"}`,
        `**Status:** ${transaction.status}`,
        includeId && `**Transaction ID:** \`${transaction.uuid}\``
    ].filter(Boolean)

    return {
        name: `${outgoing ? "Outgoing" : "Incoming"} | ${transaction.currency} ${formatCurrency(transaction.amount)}`,
        value: details.join("\n")
    }
}

export async function accountTransactionDetails(account, transactionId, showInitiatorForAll = false) {
    const transaction = await Ledger.findOne({
        attributes: ["id", "uuid", "payorId", "payeeId", "amount", "currency", "reference", "status", "createdAt"],
        where: {
            uuid: transactionId,
            [Op.or]: [
                { payorId: account.id },
                { payeeId: account.id }
            ]
        },
        include: [
            { model: Account, as: "payor", attributes: ["name", "number"] },
            { model: Account, as: "payee", attributes: ["name", "number"] }
        ]
    })

    if (!transaction) return null

    const initiators = await transactionInitiators([transaction], account, showInitiatorForAll)
    const response = message(
        "Transaction details",
        `Transaction activity for **${account.name}**`,
        undefined,
        `Transaction ID: ${transaction.uuid}`
    )

    response.allowedMentions = { parse: [] }
    response.embeds[0].addFields(transactionField(
        transaction,
        account,
        initiators.get(String(transaction.id)),
        false,
        showInitiatorForAll
    ))

    return response
}

export async function accountTransactionsPage(account, requestedPage, viewerId, interactionId = "transactions", showInitiatorForAll = false) {
    const where = {
        [Op.or]: [
            { payorId: account.id },
            { payeeId: account.id }
        ]
    }
    const count = await Ledger.count({ where })
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
    const page = Math.min(Math.max(requestedPage, 0), pageCount - 1)
    const transactions = await Ledger.findAll({
        attributes: ["id", "uuid", "payorId", "payeeId", "amount", "currency", "reference", "status", "createdAt"],
        where,
        include: [
            { model: Account, as: "payor", attributes: ["name", "number"] },
            { model: Account, as: "payee", attributes: ["name", "number"] }
        ],
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
    })
    const initiators = await transactionInitiators(transactions, account, showInitiatorForAll)
    const response = message(
        "Account transactions",
        count ? `Recent activity for **${account.name}**` : "This account has no transactions yet.",
        undefined,
        `Account: ${formatAccountNumber(account.number)} | Page ${page + 1} of ${pageCount}`
    )

    response.allowedMentions = { parse: [] }

    for (const transaction of transactions) {
        response.embeds[0].addFields(transactionField(
            transaction,
            account,
            initiators.get(String(transaction.id)),
            true,
            showInitiatorForAll
        ))
    }

    if (pageCount > 1) {
        response.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${interactionId}_${account.id}_${viewerId}_${Math.max(page - 1, 0)}`)
                .setLabel("Previous")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`${interactionId}_${account.id}_${viewerId}_${Math.min(page + 1, pageCount - 1)}`)
                .setLabel("Next")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === pageCount - 1)
        )]
    } else {
        response.components = []
    }

    return response
}
