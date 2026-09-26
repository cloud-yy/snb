import { MessageFlags } from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, User, Withdrawal, sequelize } from "#models/models"
import { transfer } from "#functions/db/account"
import { hasStaffCommandAccess } from "#functions/util/staffPermissions"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"

function failure(error) {
    switch (error?.message) {
        case "INSUFFICIENT_FUNDS":
            return message("Withdrawal not completed", "The customer account no longer has enough HC$ for this withdrawal. The request remains pending.", "INSUFFICIENT_FUNDS")
        case "ACCOUNT_FROZEN":
        case "ACCOUNT_CLOSED":
            return message("Withdrawal not completed", "One of the accounts cannot currently process this withdrawal. The request remains pending.", error.message)
        case "WITHDRAWAL_ALREADY_HANDLED":
            return message("Request already handled", "Another staff member has already completed or cancelled this request.", "WITHDRAWAL_ALREADY_HANDLED")
        default:
            return message("Withdrawal not completed", "The request remains pending. Please try again or contact support.", "WITHDRAWAL_FAILED")
    }
}

async function notifyRequester(client, request, outcome, ledger) {
    try {
        const requester = await User.findByPk(request.requesterId, { attributes: ["discordId"] })
        if (!requester?.discordId) return

        const status = outcome === "COMPLETED" ? "completed" : "cancelled"
        const notification = message(
            `Withdrawal ${status}`,
            `Your request for **HC$ ${formatCurrency(request.amount)}** has been ${status}.`,
            undefined,
            ledger ? `Transaction ID: ${ledger.uuid}` : `Request #${request.id}`
        )

        const discordUser = await client.users.fetch(requester.discordId)
        await discordUser.send(notification)
    } catch (error) {
        console.error(`Could not DM withdrawal ${request.id} status:`, error)
    }
}

export default {
    id: "withdraw",

    execute: async interaction => {
        if (!interaction.isButton()) return

        const match = /^withdraw_(\d+)_(complete|cancel)$/.exec(interaction.customId)

        if (!match || interaction.channelId !== config.withdrawalChannelId) {
            return interaction.reply({ ...message("Request unavailable", "This withdrawal request is not available here.", "WITHDRAWAL_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
        }

        if (!await hasStaffCommandAccess(interaction.client, interaction.user.id, "withdraw")) {
            return interaction.reply({ ...message("Staff access required", "Only authorised staff can process withdrawal requests.", "STAFF_ACCESS_REQUIRED"), flags: MessageFlags.Ephemeral })
        }

        const [staff] = await User.findOrCreate({ where: { discordId: interaction.user.id } })
        let reserve

        if (match[2] === "complete") {
            reserve = await Account.findOne({
                attributes: ["id", "status"],
                where: { type: "Reserve", status: "ACTIVE" },
                include: [{
                    model: User,
                    as: "users",
                    attributes: [],
                    required: true,
                    where: { id: staff.id },
                    through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Holder } } }
                }],
                order: [["id", "ASC"]]
            })

            if (!reserve) {
                return interaction.reply({ ...message("Reserve account required", "You need an active Reserve account to complete this withdrawal.", "RESERVE_ACCOUNT_REQUIRED"), flags: MessageFlags.Ephemeral })
            }
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral })
        let result

        try {
            result = await sequelize.transaction(async transaction => {
                const request = await Withdrawal.findByPk(match[1], {
                    transaction,
                    lock: transaction.LOCK.UPDATE
                })

                if (!request || request.status !== "PENDING" || request.messageId !== interaction.message.id) {
                    throw new Error("WITHDRAWAL_ALREADY_HANDLED")
                }

                if (match[2] === "cancel") {
                    await request.update({ status: "CANCELLED", processorId: staff.id }, { transaction })
                    const auditLog = await staff.createAuditLog({
                        accountId: request.accountId,
                        action: "WITHDRAWAL_CANCELLED",
                        before: { status: "PENDING", requestId: request.id },
                        after: { status: "CANCELLED", requestId: request.id }
                    }, { transaction })
                    queueAuditLogNotification(auditLog, transaction, { central: true })
                    return { request, outcome: "CANCELLED" }
                }

                const account = await Account.findByPk(request.accountId, { transaction })
                if (!account) throw new Error("ACCOUNT_NOT_FOUND")

                const ledger = await transfer(
                    account,
                    reserve,
                    Number(request.amount),
                    "HC$",
                    "Withdrawal",
                    staff,
                    { transaction, ledgerType: "WITHDRAWAL", auditAction: "WITHDRAWAL_COMPLETED", notifyAudit: true }
                )

                await request.update({ status: "COMPLETED", processorId: staff.id, ledgerId: ledger.id }, { transaction })
                return { request, outcome: "COMPLETED", ledger }
            })
        } catch (error) {
            if (error?.message !== "WITHDRAWAL_ALREADY_HANDLED") {
                console.error(`Failed to process withdrawal ${match[1]}:`, error)
            }
            return interaction.editReply(failure(error))
        }

        try {
            await interaction.message.delete()
        } catch (error) {
            console.error(`Could not delete processed withdrawal ${match[1]} message:`, error)
            await interaction.message.edit({ ...message(`Withdrawal ${result.outcome.toLowerCase()}`, `Request #${result.request.id} was ${result.outcome.toLowerCase()} by <@${interaction.user.id}>.`), components: [], allowedMentions: { parse: [] } }).catch(console.error)
        }

        await notifyRequester(interaction.client, result.request, result.outcome, result.ledger)

        return interaction.editReply(message(
            result.outcome === "COMPLETED" ? "Withdrawal completed" : "Withdrawal cancelled",
            result.outcome === "COMPLETED"
                ? `HC$ ${formatCurrency(result.request.amount)} was moved to your Reserve account. The customer was notified if their DMs are open.`
                : "The request was cancelled. No money was moved. The customer was notified if their DMs are open.",
            undefined,
            result.ledger ? `Transaction ID: ${result.ledger.uuid}` : `Request #${result.request.id}`
        ))
    }
}
