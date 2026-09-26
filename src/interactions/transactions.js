import { MessageFlags } from "discord.js"
import { Account, User } from "#models/models"
import config from "#config" with { type: "json" }
import { hasAccountAccess } from "#functions/db/account"
import message from "#functions/templates/message"
import { accountTransactionsPage } from "#functions/util/accountTransactions"

export default {
    id: "transactions",

    execute: async interaction => {
        if (!interaction.isButton()) return

        const match = /^transactions_(\d+)_(\d+)_(\d+)$/.exec(interaction.customId)

        if (!match || match[2] !== interaction.user.id) {
            return interaction.reply({
                ...message("Transactions unavailable", "This transaction view belongs to another customer or is no longer valid.", "TRANSACTIONS_UNAVAILABLE"),
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

        const [account, user] = await Promise.all([
            Account.findByPk(match[1], { attributes: ["id", "name", "number"] }),
            User.findOne({ attributes: ["id"], where: { discordId: interaction.user.id } })
        ])

        if (!await hasAccountAccess(user, account, config.accountAccesses.Viewer)) {
            return interaction.editReply({
                ...message("Account unavailable", "You no longer have permission to view transactions for this account.", "ACCOUNT_UNAVAILABLE"),
                components: []
            })
        }

        return interaction.editReply(await accountTransactionsPage(account, page, interaction.user.id))
    }
}
