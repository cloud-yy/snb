import { MessageFlags } from "discord.js"
import { Account } from "#models/models"
import message from "#functions/templates/message"
import { accountTransactionsPage } from "#functions/util/accountTransactions"
import { hasStaffCommandAccess } from "#functions/util/staffPermissions"

export default {
    id: "stafftransactions",

    execute: async interaction => {
        if (!interaction.isButton()) return

        const match = /^stafftransactions_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)

        if (!match || match[2] !== interaction.user.id || !await hasStaffCommandAccess(interaction.client, interaction.user.id, "transactions")) {
            return interaction.reply({
                ...message("Staff access required", "This transaction view is only available to the staff member who opened it.", "STAFF_ACCESS_REQUIRED"),
                flags: MessageFlags.Ephemeral
            })
        }

        const page = Number(match[3])

        if (!Number.isSafeInteger(page)) {
            return interaction.reply({
                ...message("Transactions unavailable", "This transaction page is no longer valid.", "TRANSACTIONS_UNAVAILABLE"),
                flags: MessageFlags.Ephemeral
            })
        }

        await interaction.deferUpdate()

        const account = await Account.findByPk(match[1], {
            attributes: ["id", "name", "number"]
        })

        if (!account) {
            return interaction.editReply({
                ...message("Account unavailable", "This account could not be found.", "ACCOUNT_NOT_FOUND"),
                components: []
            })
        }

        return interaction.editReply(await accountTransactionsPage(
            account,
            page,
            interaction.user.id,
            "stafftransactions",
            true
        ))
    }
}
