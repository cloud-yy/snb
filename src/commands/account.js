import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Account, AccountBalance,  } from "#models/models"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("account")
            .setDescription("Commands for managing accounts")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("balance")
                    .setDescription("Views the balance of the specified account")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account to view the balance of")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addBooleanOption((option) =>
                        option
                            .setName("show")
                            .setDescription("Show the output publically (default: false)")
                    )
                    .addStringOption((option) =>
                        option
                            .setName("currency")
                            .setDescription("Get the balance of a specific currency (optional)")
                            .addChoices(config.currencies.map(currency => ({ name: currency, value: currency })))
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("transfer")
                    .setDescription("Transfers money from one account to another")
                    .addStringOption((option) =>
                        option
                            .setName("from")
                            .setDescription("The account to transfer from")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("to")
                            .setDescription("The account to transfer to")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addIntegerOption((option) =>
                        option
                            .setName("amount")
                            .setDescription("The amount to transfer")
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("currency")
                            .setDescription("The currency of the transfer")
                            .setRequired(true)
                            .addChoices(config.currencies.map(currency => ({ name: currency, value: currency })))
                    )
                    .addBooleanOption((option) =>
                        option
                            .setName("show")
                            .setDescription("Show the output publically (default: false)")
                    )
            ),

    cooldown: 0,
    scope: "global",

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()

        switch(command) {
            case "balance": {
                const account = interaction.options.getString("account")
                const show = interaction.options.getBoolean("show")
                const currency = interaction.options.getString("currency")

                const balances = await AccountBalance.findAll({
                    where: [
                        { accountId: account },
                        currency
                            ? { currency }
                            : [] 
                    ],
                })

                const balanceText = balances.map(balance => `${balance.currency}${formatCurrency(balance.balance)}`).join("\n")

                return interaction.reply({ content: balanceText, flags: show ? undefined : MessageFlags.Ephemeral }) 
            }
        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "from":
            case "to":
            case "account": {
                const reserveOnly = focused.name === "reserve"

                const accounts = await Account.findAll({
                    where: {[Op.and]: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                        
                        reserveOnly
                            ? { type: "Reserve" }
                            : { type: { [Op.ne]: "Reserve" } }
                    ]},

                    limit: 25
                })

		        await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.id })))
            }
        }
    }
}