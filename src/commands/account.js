import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Account, AccountAccess, AccountBalance, AuditLog, Ledger, sequelize, User,  } from "#models/models"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import { accountFromNumber, transfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("account")
            .setDescription("Commands for managing accounts")

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
                    .addNumberOption((option) =>
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
                    .addStringOption((option) =>
                        option
                            .setName("reference")
                            .setDescription("The reference of the transfer")
                            .setMinLength(1)
                            .setMaxLength(18)
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


                if (balances.length === 0) {
                    return interaction.reply({ content: "This account holds no such balance(s)", flags: show ? undefined : MessageFlags.Ephemeral }) 
                }

                const balanceText = balances.map(balance => `${balance.currency} ${formatCurrency(balance.balance)}`).join("\n")

                return interaction.reply({ content: balanceText, flags: show ? undefined : MessageFlags.Ephemeral }) 
            }

            case "transfer": {
                const from = interaction.options.getString("from")
                const to = interaction.options.getString("to")
                const rawAmount = interaction.options.getNumber("amount")
                const currency = interaction.options.getString("currency")
                const reference = interaction.options.getString("reference") || "Transfer"
                const show = interaction.options.getBoolean("show")

                const fromAccount = await accountFromNumber(from)

                if (!fromAccount) {
                    return interaction.reply({ content: "Sending account not found!", flags: MessageFlags.Ephemeral })
                }

                const toAccount = await accountFromNumber(to)

                if (!toAccount) {
                    return interaction.reply({ content: "Receiving account not found!", flags: MessageFlags.Ephemeral })
                }

                const user = userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ content: "Your user profile has not been found!", flags: MessageFlags.Ephemeral })
                }

                try {
                    const ledger = await transfer(fromAccount, toAccount, rawAmount, currency, reference, user, false)

                    return interaction.reply({ content: `Success!\n${currency} ${formatCurrency(amount)} has been been transfered!\n${formatAccountNumber(from)} > ${formatAccountNumber(to)}`,flags: show ? undefined : MessageFlags.Ephemeral })
                } catch (error) {
                    return interaction.reply({ content: `There was an error during this transfer, no money has been moved. Please contact support if this issue persists.\n${error}`, flags: MessageFlags.Ephemeral })
                }
            }
        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "to":
                const accounts = await Account.findAll({
                    where: {[Op.and]: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                    ]},

                    limit: 25
                })

		        return await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.number })))
            case "from":
            case "account": {
                const accounts = await Account.findAll({
                    where: {[Op.and]: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                    ]},

                    include: [{
                        model: User,
                        as: "users",
                        required: true,
                        where: { discordId: interaction.user.id }
                    }],

                    limit: 25
                })

		        return await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.number })))
            }
        }
    }
}