import { Op } from "sequelize"
import { Account, BusinessLog, Ledger } from "#models/models"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"

let client

export function configureBusinessLogNotifications(discordClient) {
    client = discordClient
}

export async function sendBusinessLog(channelId, payload) {
    if (!client || !channelId) return false

    const channel = await client.channels.fetch(channelId)
    if (!channel?.isTextBased() || typeof channel.send !== "function") return false
    await channel.send(payload)
    return true
}

function transactionPayload(ledger, accountId) {
    const outgoing = String(ledger.payorId) === String(accountId)
    const account = outgoing ? ledger.payor : ledger.payee
    const other = outgoing ? ledger.payee : ledger.payor
    const date = Math.floor(ledger.createdAt.getTime() / 1000)

    return {
        ...message(
            outgoing ? "Outgoing transaction" : "Incoming transaction",
            [
                `**Amount:** ${ledger.currency} ${formatCurrency(ledger.amount)}`,
                `**Account:** ${account.name} (${formatAccountNumber(account.number)})`,
                `**${outgoing ? "To" : "From"}:** ${other.name} (${formatAccountNumber(other.number)})`,
                `**Reference:** ${ledger.reference}`,
                `**Type:** ${ledger.type}`,
                `**Status:** ${ledger.status}`,
                `**Date:** <t:${date}:f>`
            ].join("\n"),
            undefined,
            `Transaction ID: ${ledger.uuid}`
        ),
        allowedMentions: { parse: [] }
    }
}

export function queueBusinessTransactionNotification(ledger, transaction) {
    if (!client || !ledger?.id) return

    const deliver = async () => {
        try {
            const storedLedger = await Ledger.findByPk(ledger.id, {
                attributes: ["id", "uuid", "payorId", "payeeId", "amount", "currency", "status", "type", "reference", "createdAt"],
                include: [
                    { model: Account, as: "payor", attributes: ["name", "number"] },
                    { model: Account, as: "payee", attributes: ["name", "number"] }
                ]
            })
            if (!storedLedger) return

            const settings = await BusinessLog.findAll({
                attributes: ["accountId", "transactionChannelId"],
                where: {
                    accountId: { [Op.in]: [storedLedger.payorId, storedLedger.payeeId] },
                    transactionChannelId: { [Op.ne]: null }
                }
            })
            const deliveries = await Promise.allSettled(settings.map(setting =>
                sendBusinessLog(setting.transactionChannelId, transactionPayload(storedLedger, setting.accountId))))
            const failed = deliveries.filter(result => result.status === "rejected").length
            if (failed) console.warn(`Unable to deliver ${failed} business transaction log(s).`)
        } catch (error) {
            console.error("Failed to send business transaction logs:", error)
        }
    }

    if (transaction?.afterCommit) {
        transaction.afterCommit(() => { void deliver() })
    } else {
        void deliver()
    }
}
