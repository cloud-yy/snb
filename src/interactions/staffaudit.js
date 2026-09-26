import { MessageFlags } from "discord.js"
import { Account, User } from "#models/models"
import message from "#functions/templates/message"
import { auditLogPage } from "#functions/util/auditLogs"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import { hasStaffCommandAccess } from "#functions/util/staffPermissions"

export default {
    id: "staffaudit",

    execute: async interaction => {
        if (!interaction.isButton()) return

        const match = /^staffaudit_(user|account)_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)

        if (!match || match[3] !== interaction.user.id || !await hasStaffCommandAccess(interaction.client, interaction.user.id, "logs")) {
            return interaction.reply({ ...message("Staff access required", "This audit log view is only available to the staff member who opened it.", "STAFF_ACCESS_REQUIRED"), flags: MessageFlags.Ephemeral })
        }

        const [, mode, targetId, viewerId, rawPage] = match
        const page = Number(rawPage)

        if (!Number.isSafeInteger(page)) {
            return interaction.reply({ ...message("Audit logs unavailable", "This audit log page is no longer valid.", "AUDIT_LOGS_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
        }

        await interaction.deferUpdate()

        if (mode === "user") {
            const user = await User.findByPk(targetId, { attributes: ["id", "discordId", "robloxName"] })

            if (!user) {
                return interaction.editReply({ ...message("Customer not found", "This customer profile could not be found.", "CUSTOMER_NOT_FOUND"), components: [] })
            }

            return interaction.editReply(await auditLogPage({
                where: { userId: user.id },
                requestedPage: page,
                buttonBase: `staffaudit_user_${user.id}_${viewerId}`,
                title: "Customer audit logs",
                description: `Actions recorded for ${user.discordId ? `<@${user.discordId}>` : user.robloxName || "this customer"}.`,
                footer: "Customer audit logs",
                showActor: false,
                showAccount: true
            }))
        }

        const account = await Account.findByPk(targetId, { attributes: ["id", "name", "number"] })

        if (!account) {
            return interaction.editReply({ ...message("Account unavailable", "This account could not be found.", "ACCOUNT_NOT_FOUND"), components: [] })
        }

        return interaction.editReply(await auditLogPage({
            where: { accountId: account.id },
            requestedPage: page,
            buttonBase: `staffaudit_account_${account.id}_${viewerId}`,
            title: "Account audit logs",
            description: `Recorded activity for **${account.name}**.`,
            footer: `Account: ${formatAccountNumber(account.number)}`,
            showActor: true,
            showAccount: false
        }))
    }
}
