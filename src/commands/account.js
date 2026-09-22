import {
    ApplicationIntegrationType,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder
} from "discord.js"
import { Account, User } from "#models/models"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import { accountFromNumber, getAccountAccess, hasAccountAccess, setAccountAccess, transfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("account")
            .setDescription("Commands for managing accounts")
            .setIntegrationTypes(
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall
            )
            .setContexts(
                InteractionContextType.Guild,
                InteractionContextType.BotDM,
                InteractionContextType.PrivateChannel
            )

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
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("user")
                    .setDescription("Sets a user's access level for an account")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account to manage")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addUserOption((option) =>
                        option
                            .setName("user")
                            .setDescription("The user whose access will be set")
                            .setRequired(true)
                    )
                    .addIntegerOption((option) =>
                        option
                            .setName("role")
                            .setDescription("The user's account role")
                            .setRequired(true)
                            .addChoices(
                                Object.entries(config.accountAccesses).map(([name, value]) => ({ name, value }))
                            )
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

                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ content: "Your user profile has not been found!", flags: MessageFlags.Ephemeral })
                }

                const selectedAccount = await accountFromNumber(account)

                if (!selectedAccount || !await hasAccountAccess(user, selectedAccount, config.accountAccesses.Viewer)) {
                    return interaction.reply({ content: "Account not found or you do not have access to it!", flags: MessageFlags.Ephemeral })
                }

                const balances = await selectedAccount.getAccountBalances({
                    attributes: ["balance", "currency"],
                    where: currency ? { currency } : undefined
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

                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ content: "Your user profile has not been found!", flags: MessageFlags.Ephemeral })
                }

                const fromAccount = await accountFromNumber(from)

                if (!fromAccount || !await hasAccountAccess(user, fromAccount, config.accountAccesses.Signatory)) {
                    return interaction.reply({ content: "Sending account not found or you do not have permission to transfer from it!", flags: MessageFlags.Ephemeral })
                }

                const toAccount = await accountFromNumber(to)

                if (!toAccount) {
                    return interaction.reply({ content: "Receiving account not found!", flags: MessageFlags.Ephemeral })
                }

                let ledger

                try {
                    ledger = await transfer(fromAccount, toAccount, rawAmount, currency, reference, user, false)
                } catch (error) {
                    return interaction.reply({ content: `There was an error during this transfer, no money has been moved. Please contact support if this issue persists.\n${error}`, flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ content: `Success!\n${currency} ${formatCurrency(ledger.amount)} has been transferred!\n${formatAccountNumber(from)} > ${formatAccountNumber(to)}\nTransaction ID: ${ledger.uuid}`, flags: show ? undefined : MessageFlags.Ephemeral })
            }

            case "user": {
                const accountNumber = interaction.options.getString("account")
                const discordUser = interaction.options.getUser("user")
                const requestedAccess = interaction.options.getInteger("role")
                const roleName = Object.entries(config.accountAccesses)
                    .find(([, access]) => access === requestedAccess)?.[0]
                const selectedAccount = await accountFromNumber(accountNumber)
                const actor = await userFromDiscord(interaction.user.id)

                if (!roleName) {
                    return interaction.reply({ content: "That account role is invalid!", flags: MessageFlags.Ephemeral })
                }

                if (!actor) {
                    return interaction.reply({ content: "Your user profile has not been found!", flags: MessageFlags.Ephemeral })
                }

                const actorAccess = await getAccountAccess(actor, selectedAccount)

                if (!selectedAccount || actorAccess === null || actorAccess < config.accountAccesses.Manager) {
                    return interaction.reply({ content: "Account not found or you do not have permission to manage its users!", flags: MessageFlags.Ephemeral })
                }

                const target = await userFromDiscord(discordUser.id)

                if (!target) {
                    return interaction.reply({ content: "That user's profile has not been found!", flags: MessageFlags.Ephemeral })
                }

                const targetAccess = await getAccountAccess(target, selectedAccount)
                const managesElevatedAccess = requestedAccess >= config.accountAccesses.Manager
                    || targetAccess >= config.accountAccesses.Manager

                if (actorAccess < config.accountAccesses.Holder && managesElevatedAccess) {
                    return interaction.reply({ content: "Only account holders can add or change Managers and Holders!", flags: MessageFlags.Ephemeral })
                }

                try {
                    await setAccountAccess(actor, target, selectedAccount, requestedAccess)
                } catch (error) {
                    console.error("Failed to update account access!", error)
                    return interaction.reply({ content: "There was an error updating that user's account access.", flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ content: `${discordUser}'s role for ${selectedAccount.name} has been set to ${roleName}.`, flags: MessageFlags.Ephemeral })
            }
        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "to":
                const accounts = await Account.findAll({
                    attributes: ["name", "number", "type"],
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
                const command = interaction.options.getSubcommand()
                const requiredAccess = focused.name === "from"
                    ? config.accountAccesses.Signatory
                    : command === "user"
                        ? config.accountAccesses.Manager
                        : config.accountAccesses.Viewer
                const accounts = await Account.findAll({
                    attributes: ["name", "number", "type"],
                    where: {[Op.and]: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                    ]},

                    include: [{
                        model: User,
                        as: "users",
                        attributes: [],
                        required: true,
                        where: { discordId: interaction.user.id },
                        through: {
                            attributes: [],
                            where: {
                                access: {
                                    [Op.gte]: requiredAccess
                                }
                            }
                        }
                    }],

                    limit: 25
                })

		        return await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.number })))
            }
        }
    }
}
