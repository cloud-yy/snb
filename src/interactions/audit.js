import { MessageFlags } from "discord.js"
import { Account, User } from "#models/models"
import config from "#config" with { type: "json" }
import { hasAccountAccess } from "#functions/db/account"
import message from "#functions/templates/message"
import { auditLogPage } from "#functions/util/auditLogs"
import formatAccountNumber from "#functions/util/formatAccountNumber"

export default {
    id: "audit",

    execute: async interaction => {
        if (!interaction.isButton()) return

        const match = /^audit_(user|account)_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)

        if (!match || match[3] !== interaction.user.id) {
            return interaction.reply({
                ...message("Audit logs unavailable", "This audit log view belongs to another customer or is no longer valid.", "AUDIT_LOGS_UNAVAILABLE"),
                flags: MessageFlags.Ephemeral
            })
        }

        const [, mode, targetId, viewerId, rawPage] = match
        const page = Number(rawPage)

        if (!Number.isSafeInteger(page)) {
            return interaction.reply({ ...message("Audit logs unavailable", "This audit log page is no longer valid.", "AUDIT_LOGS_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
        }

        await interaction.deferUpdate()

        const user = await User.findOne({ attributes: ["id"], where: { discordId: interaction.user.id } })

        if (mode === "user") {
            if (!user || String(user.id) !== targetId) {
                return interaction.editReply({ ...message("Audit logs unavailable", "You can no longer view these audit logs.", "AUDIT_LOGS_UNAVAILABLE"), components: [] })
            }

            return interaction.editReply(await auditLogPage({
                where: { userId: user.id },
                requestedPage: page,
                buttonBase: `audit_user_${user.id}_${viewerId}`,
                title: "Your audit logs",
                description: "Actions recorded for your customer profile.",
                footer: "Personal audit logs",
                showActor: false,
                showAccount: true
            }))
        }

        const account = await Account.findByPk(targetId, { attributes: ["id", "name", "number"] })

        if (!await hasAccountAccess(user, account, config.accountAccesses.Viewer)) {
            return interaction.editReply({ ...message("Account unavailable", "You no longer have permission to view audit logs for this account.", "ACCOUNT_UNAVAILABLE"), components: [] })
        }

        return interaction.editReply(await auditLogPage({
            where: { accountId: account.id },
            requestedPage: page,
            buttonBase: `audit_account_${account.id}_${viewerId}`,
            title: "Account audit logs",
            description: `Recorded activity for **${account.name}**.`,
            footer: `Account: ${formatAccountNumber(account.number)}`,
            showActor: true,
            showAccount: false
        }))
    }
}
