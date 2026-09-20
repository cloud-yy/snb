import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Account, AccountBalance, AuditLog, Ledger, sequelize, User } from "#models/models"
import companyInfo from "#functions/templates/companyInfo"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import { createAccount } from "#functions/db/account"
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
                    .setDescription("Registers a deposit and debits relevant accounts")
                    .addStringOption((option) =>
                        option
                            .setName("embed")
                            .setDescription("The name of the embed you want to send")
                            .setRequired(true)
                            .addChoices(
                                { name: "Company Info", value: "companyInfo" },
                                { name: "Register Prompt", value: "register" },
                                { name: "Open Account", value: "openAccount" },
                                { name: "Account Options", value: "accountOptions" }
                            )
                    )
            ),

    cooldown: 0,
    scope: "local",

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()

        switch(command) {
            case "embed": {
                const channel = interaction.options.getChannel("channel") || interaction.channel

                await channel.send(companyInfo)

                return interaction.reply({ content: `Message successfully sent in <#${channel.id}>`, flags: MessageFlags.Ephemeral })
            }

            case "deposit": {
                const reserve = interaction.options.getString("reserve")
                const account = interaction.options.getString("account")
                const rawAmount = interaction.options.getNumber("amount")
                const currency = interaction.options.getString("currency")

                const amount = Math.round(rawAmount * 100) / 100;

                try {
                    const [oldReserveBalance, newReserveBalance, oldAccountBalance, newAccountBalance] = await sequelize.transaction(async transaction => {
                        const [reserveBalance, reserveCreated] = await AccountBalance.findOrCreate({
                            where: { accountId: reserve },
                            defaults: {
                                balance: 0,
                                currency
                            },
                            transaction
                        })

                        const oldReserveBalance = reserveBalance.balance

                        await reserveBalance.increment("balance", {
                            by: -amount,
                            transaction
                        })

                        const [accountBalance, accountCreated] = await AccountBalance.findOrCreate({
                            where: { accountId: account },
                            defaults: {
                                balance: 0,
                                currency
                            },
                            transaction
                        })

                        const oldAccountBalance = accountBalance.balance

                        await accountBalance.increment("balance", {
                            by: amount,
                            transaction
                        })

                        await Ledger.create({
                            payorId: reserve,
                            payeeId: account,
                            amount,
                            currency,
                            status: "SUCCESS",
                            type: "DEPOSIT",
                            reference: "Account Deposit"
                        }, { transaction })

                        const user = await User.findOne({
                            where: { discordId: interaction.user.id }
                        }, { transaction })

                        if (!user) {
                            throw new Error("User not found.")
                        }

                        await AuditLog.create({
                            action: {
                                type: "DEPOSIT",
                                amount,
                                currency
                            },
                            before: { balance: oldReserveBalance, currency: currency },
                            after:  { balance: reserveBalance.balance, currency: currency },
                            accountId: reserve,
                            userId: user.id
                        }, { transaction })

                        return [oldReserveBalance, reserveBalance.balance, oldAccountBalance, accountBalance.balance]
                    })

                    return interaction.reply({ content: `Success!\n${currency} ${formatCurrency(amount)} has been deposited!\nReserve: ${currency} ${formatCurrency(oldReserveBalance)} >>> ${currency} ${formatCurrency(newReserveBalance)}\nAccount: ${currency} ${formatCurrency(oldAccountBalance)} >>> ${currency} ${formatCurrency(newAccountBalance)}`, flags: MessageFlags.Ephemeral })
                } catch (error) {
                    console.error("Failed to deposit!", error)
                    return interaction.reply({ content: "There was an error running this database transaction.", flags: MessageFlags.Ephemeral })
                }
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
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "account":
            case "reserve": {
                const reserveOnly = focused.name === "reserve"

                const accounts = await Account.findAll({
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

		        await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.id })))
            }
        }
    }
}