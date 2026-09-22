import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Account } from "#models/models"
import register from "#functions/templates/register"
import { login as access } from "#functions/templates/access"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import { accountFromNumber, createAccount, transfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import formatCurrency from "#functions/util/formatCurrency"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("staff")
            .setDescription("Staff commands reserved for employees of the company")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("deposit")
                    .setDescription("Sends the selected embed in the selected channel")
                    .addStringOption((option) =>
                        option
                            .setName("reserve")
                            .setDescription("The account that holds the customers money")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account recieving the deposit")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addNumberOption((option) =>
                        option
                            .setName("amount")
                            .setDescription("The amount deposited")
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("currency")
                            .setDescription("The currency of the deposit")
                            .setRequired(true)
                            .addChoices(config.currencies.map(currency => ({ name: currency, value: currency })))
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("open")
                    .setDescription("Opens an account")
                    .addStringOption((option) =>
                        option
                            .setName("type")
                            .setDescription("The type of the account")
                            .setRequired(true)
                            .addChoices(
                                Object.keys(config.accounts).map(name => ({ name: name, value: name }))
                            )
                    )
                    .addUserOption((option) =>
                        option
                            .setName("holder")
                            .setDescription("The account holders")
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("name")
                            .setDescription("The optional account name")
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("embed")
                    .setDescription("Sends a system prompt in the current channel")
                    .addStringOption((option) =>
                        option
                            .setName("embed")
                            .setDescription("The name of the embed you want to send")
                            .setRequired(true)
                            .addChoices(
                                { name: "Register Prompt", value: "register" },
                                { name: "Online Banking", value: "access" }
                            )
                    )
            ),

    cooldown: 0,
    scope: "local",

    execute: async (interaction) => {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "You do not have permission to use this command.", flags: MessageFlags.Ephemeral })
        }

        const command = interaction.options.getSubcommand()

        switch(command) {
            case "embed": {
                const channel = interaction.options.getChannel("channel") || interaction.channel
                const selectedEmbed = interaction.options.getString("embed")
                const templates = { access, register }

                await channel.send(templates[selectedEmbed])

                return interaction.reply({ content: `Message successfully sent in <#${channel.id}>`, flags: MessageFlags.Ephemeral })
            }

            case "deposit": {
                const reserve = interaction.options.getString("reserve")
                const account = interaction.options.getString("account")
                const rawAmount = interaction.options.getNumber("amount")
                const currency = interaction.options.getString("currency")

                const reserveAccount = await accountFromNumber(reserve)

                if (!reserveAccount || reserveAccount.type !== "Reserve") {
                    return interaction.reply({ content: "Valid reserve account not found!", flags: MessageFlags.Ephemeral })
                }

                const receivingAccount = await accountFromNumber(account)

                if (!receivingAccount || receivingAccount.type === "Reserve") {
                    return interaction.reply({ content: "Valid receiving account not found!", flags: MessageFlags.Ephemeral })
                }

                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ content: "Your user profile has not been found!", flags: MessageFlags.Ephemeral })
                }

                let ledger

                try {
                    ledger = await transfer(reserveAccount, receivingAccount, rawAmount, currency, "Account Deposit", user, true)
                } catch (error) {
                    console.error("Failed to deposit!", error)
                    return interaction.reply({ content: `There was an error during this deposit, no money has been moved. Please contact support if this issue persists.\n${error}`, flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ content: `Success!\n${currency} ${formatCurrency(ledger.amount)} has been deposited!\n${formatAccountNumber(reserve)} > ${formatAccountNumber(account)}\nTransaction ID: ${ledger.uuid}`, flags: MessageFlags.Ephemeral })
            }

            case "open": {
                const type = interaction.options.getString("type")
                const holder = interaction.options.getUser("holder")
                const name = interaction.options.getString("name")

                const user = await userFromDiscord(holder.id)

                if (!user) {
                    return interaction.reply({ content: "Unable to find user in database, they may not be setup yet.", flags: MessageFlags.Ephemeral }) 
                }

                const account = await createAccount(user, type, name)

                if (!account) {
                    return interaction.reply({ content: "There as an error making this account.", flags: MessageFlags.Ephemeral }) 
                }

                return interaction.reply({ content: `Account Created\nName: ${account.name}\nNumber: ${formatAccountNumber(account.number)}\nType: ${account.type}\nStatus: ${account.status}`, flags: MessageFlags.Ephemeral }) 
            }
        }
    },

    autocomplete: async (interaction) => {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.respond([])
        }

        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "account":
            case "reserve": {
                const reserveOnly = focused.name === "reserve"

                const accounts = await Account.findAll({
                    attributes: ["name", "number", "type"],
                    where: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                        
                        reserveOnly
                            ? { type: "Reserve" }
                            : { type: { [Op.ne]: "Reserve" } }
                    ],

                    limit: 25
                })

		        await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.number })))
            }
        }
    }
}
