import { MessageFlags } from "discord.js"
import config from "#config" with { type: "json" }
import { User, Withdrawal, sequelize } from "#models/models"
import { hasStaffCommandAccess } from "#functions/util/staffPermissions"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"

function requestLabel(request) {
    return request.type === "DEPOSIT" ? "Deposit" : "Withdrawal"
}

async function notifyRequester(client, request) {
    try {
        const requester = await User.findByPk(request.requesterId, { attributes: ["discordId"] })
        if (!requester?.discordId) return
        const label = requestLabel(request)
        const status = request.status === "COMPLETED" ? "completed" : "declined"
        const discordUser = await client.users.fetch(requester.discordId)
        await discordUser.send(message(
            `${label} request ${status}`,
            `Your request for **${request.currency} ${formatCurrency(request.amount)}** was marked as ${status} by staff.`,
            undefined,
            `Request #${request.id}`
        ))
    } catch (error) {
        console.error(`Could not DM account request ${request.id} status:`, error)
    }
}

export default {
    id: "cashrequest",

    async execute(interaction) {
        if (!interaction.isButton()) return
        const match = /^cashrequest_(\d+)_(complete|decline)$/.exec(interaction.customId)
        if (!match || interaction.channelId !== (config.requestChannelId || config.withdrawalChannelId)) {
            return interaction.reply({ ...message("Request unavailable", "This account request is not available here.", "ACCOUNT_REQUEST_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
        }

        const pendingRequest = await Withdrawal.findByPk(match[1], { attributes: ["id", "type"] })
        const permission = pendingRequest?.type === "DEPOSIT" ? "deposit" : "withdraw"
        if (!await hasStaffCommandAccess(interaction.client, interaction.user.id, permission)) {
            return interaction.reply({ ...message("Staff access required", "Only authorised staff can process this request.", "STAFF_ACCESS_REQUIRED"), flags: MessageFlags.Ephemeral })
        }

        const [staff] = await User.findOrCreate({ where: { discordId: interaction.user.id } })
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        let request

        try {
            request = await sequelize.transaction(async transaction => {
                const lockedRequest = await Withdrawal.findByPk(match[1], {
                    transaction,
                    lock: transaction.LOCK.UPDATE
                })
                if (!lockedRequest || lockedRequest.status !== "PENDING" || lockedRequest.messageId !== interaction.message.id) {
                    throw new Error("ACCOUNT_REQUEST_ALREADY_HANDLED")
                }

                const status = match[2] === "complete" ? "COMPLETED" : "DECLINED"
                await lockedRequest.update({ status, processorId: staff.id }, { transaction })
                const auditLog = await staff.createAuditLog({
                    accountId: lockedRequest.accountId,
                    action: `${lockedRequest.type}_REQUEST_${status}`,
                    before: { requestId: lockedRequest.id, status: "PENDING" },
                    after: { requestId: lockedRequest.id, status }
                }, { transaction })
                queueAuditLogNotification(auditLog, transaction, { central: true })
                return lockedRequest
            })
        } catch (error) {
            if (error?.message !== "ACCOUNT_REQUEST_ALREADY_HANDLED") {
                console.error(`Failed to process account request ${match[1]}:`, error)
            }
            return interaction.editReply(message("Request already handled", "Another staff member has already completed or declined this request.", "ACCOUNT_REQUEST_ALREADY_HANDLED"))
        }

        const label = requestLabel(request)
        const status = request.status === "COMPLETED" ? "completed" : "declined"
        await interaction.message.edit({
            ...message(
                `${label} request ${status}`,
                `Request #${request.id} was marked as **${status}** by <@${interaction.user.id}>.\nNo money was moved by this button.`,
                undefined,
                `Request #${request.id}`
            ),
            components: [],
            allowedMentions: { parse: [] }
        }).catch(error => console.error(`Could not update account request ${request.id} message:`, error))

        await notifyRequester(interaction.client, request)
        return interaction.editReply(message(
            `${label} request ${status}`,
            "The customer was notified. This status change did not move any money.",
            undefined,
            `Request #${request.id}`
        ))
    }
}
