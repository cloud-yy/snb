import { MessageFlags } from "discord.js"
import config from "#config" with { type: "json" }
import { User } from "#models/models"
import { hasStaffCommandAccess } from "#functions/util/staffPermissions"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"

const processingMessages = new Set()
const handledMessages = new Set()

function parseRequest(customId) {
    const match = /^cashrequest_([DW])_(\d+)_(\d+)_(\d+)_([A-Za-z0-9_-]+)_(complete|decline)$/.exec(customId)
    if (!match) return null

    const [, requestType, accountId, requesterDiscordId, amountInMinorUnits, encodedCurrency, action] = match
    const currency = Buffer.from(encodedCurrency, "base64url").toString("utf8")
    if (!config.currencies.includes(currency)) return null

    return {
        type: requestType === "D" ? "DEPOSIT" : "WITHDRAWAL",
        accountId,
        requesterDiscordId,
        amount: Number(amountInMinorUnits) / 100,
        currency,
        action
    }
}

function requestLabel(request) {
    return request.type === "DEPOSIT" ? "Deposit" : "Withdrawal"
}

async function notifyRequester(client, request, status) {
    try {
        const discordUser = await client.users.fetch(request.requesterDiscordId)
        await discordUser.send(message(
            `${requestLabel(request)} request ${status}`,
            `Your request for **${request.currency} ${formatCurrency(request.amount)}** was marked as ${status} by staff.`
        ))
    } catch (error) {
        console.error("Could not DM account request status:", error)
    }
}

function alreadyHandled(interaction) {
    return interaction.reply({
        ...message("Request already handled", "Another staff member has already completed or declined this request.", "ACCOUNT_REQUEST_ALREADY_HANDLED"),
        flags: MessageFlags.Ephemeral
    })
}

export default {
    id: "cashrequest",

    async execute(interaction) {
        if (!interaction.isButton()) return
        const request = parseRequest(interaction.customId)
        if (!request || interaction.channelId !== (config.requestChannelId || config.withdrawalChannelId)) {
            return interaction.reply({ ...message("Request unavailable", "This account request is not available here.", "ACCOUNT_REQUEST_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
        }

        const permission = request.type === "DEPOSIT" ? "deposit" : "withdraw"
        if (!await hasStaffCommandAccess(interaction.client, interaction.user.id, permission)) {
            return interaction.reply({ ...message("Staff access required", "Only authorised staff can process this request.", "STAFF_ACCESS_REQUIRED"), flags: MessageFlags.Ephemeral })
        }

        const messageId = interaction.message.id
        if (processingMessages.has(messageId) || handledMessages.has(messageId)) return alreadyHandled(interaction)
        processingMessages.add(messageId)
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        const status = request.action === "complete" ? "completed" : "declined"
        try {
            const [staff] = await User.findOrCreate({ where: { discordId: interaction.user.id } })
            const auditLog = await staff.createAuditLog({
                accountId: request.accountId,
                action: `${request.type}_REQUEST_${status.toUpperCase()}`,
                before: { status: "PENDING" },
                after: {
                    status: status.toUpperCase(),
                    amount: request.amount,
                    currency: request.currency,
                    requesterDiscordId: request.requesterDiscordId
                }
            })
            queueAuditLogNotification(auditLog, undefined, { central: true })

            await interaction.message.edit({
                ...message(
                    `${requestLabel(request)} request ${status}`,
                    `This request for **${request.currency} ${formatCurrency(request.amount)}** was marked as **${status}** by <@${interaction.user.id}>.\nNo money was moved by this button.`
                ),
                components: [],
                allowedMentions: { parse: [] }
            })
            handledMessages.add(messageId)
            if (handledMessages.size > 10000) handledMessages.delete(handledMessages.values().next().value)
        } catch (error) {
            console.error("Failed to process account request:", error)
            processingMessages.delete(messageId)
            return interaction.editReply(message("Request not updated", "The request could not be updated. Please try again.", "ACCOUNT_REQUEST_UPDATE_FAILED"))
        }

        processingMessages.delete(messageId)
        await notifyRequester(interaction.client, request, status)
        return interaction.editReply(message(
            `${requestLabel(request)} request ${status}`,
            "The customer was notified. This status change did not move any money."
        ))
    }
}
