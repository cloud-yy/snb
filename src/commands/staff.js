import { MessageFlags, SlashCommandBuilder } from "discord.js"
import { Account, User } from "#models/models"
import register from "#functions/templates/register"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import { accountFromNumber, createAccount, setAccountAccess, setAccountStatus, transfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import { accountTransactionDetails, accountTransactionsPage } from "#functions/util/accountTransactions"
import { auditLogPage } from "#functions/util/auditLogs"
import { hasStaffCommandAccess } from "#functions/util/staffPermissions"

function depositErrorMessage(error) {
    switch (error?.message) {
        case "SAME_ACCOUNT":
            return message("Deposit not completed", "The reserve and receiving accounts must be different.", "SAME_ACCOUNT")
        case "ACCOUNT_FROZEN":
            return message("Deposit not completed", "One of the accounts cannot currently process deposits.", "ACCOUNT_FROZEN")
        case "ACCOUNT_CLOSED":
            return message("Deposit not completed", "Closed accounts cannot process deposits.", "ACCOUNT_CLOSED")
        case "INVALID_AMOUNT":
            return message("Deposit not completed", "Enter an amount greater than zero, using no more than two decimal places.", "INVALID_AMOUNT")
        default:
            return message("Deposit not completed", "The deposit could not be completed and no money was moved. Please try again.", "DEPOSIT_FAILED")
    }
}

function withdrawalErrorMessage(error) {
    switch (error?.message) {
        case "SAME_ACCOUNT":
            return message("Withdrawal not completed", "The customer and reserve accounts must be different.", "SAME_ACCOUNT")
        case "INVALID_AMOUNT":
            return message("Withdrawal not completed", "Enter an amount greater than zero, using no more than two decimal places.", "INVALID_AMOUNT")
        case "INSUFFICIENT_FUNDS":
            return message("Withdrawal not completed", "The customer account does not have enough funds in that currency.", "INSUFFICIENT_FUNDS")
        default:
            return message("Withdrawal not completed", "The withdrawal could not be completed and no money was moved. Please try again.", "WITHDRAWAL_FAILED")
    }
}

export default {
    command: 
        new SlashCommandBuilder()
            .setName("staff")
            .setDescription("Staff commands reserved for employees of the company")

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("deposit")
                    .setDescription("Moves money from a reserve account into a customer account")
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
                    .setName("withdraw")
                    .setDescription("Moves money from a customer account into a reserve account")
                    .addStringOption((option) =>
                        option
                            .setName("reserve")
                            .setDescription("The reserve account receiving the withdrawn money")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The customer account being withdrawn from")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addNumberOption((option) =>
                        option
                            .setName("amount")
                            .setDescription("The amount withdrawn")
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("currency")
                            .setDescription("The currency of the withdrawal")
                            .setRequired(true)
                            .addChoices(config.currencies.map(currency => ({ name: currency, value: currency })))
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("access")
                    .setDescription("Sets a customer's account access without account limits")
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
                            .setDescription("The customer whose access will be set")
                            .setRequired(true)
                    )
                    .addIntegerOption((option) =>
                        option
                            .setName("role")
                            .setDescription("The account role to assign")
                            .setRequired(true)
                            .addChoices(
                                Object.entries(config.accountAccesses).map(([name, value]) => ({ name, value }))
                            )
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("transactions")
                    .setDescription("Views transactions for any account")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account to view")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("id")
                            .setDescription("A transaction ID to look up (optional)")
                            .setMinLength(36)
                            .setMaxLength(36)
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("logs")
                    .setDescription("Views audit logs for any account or customer")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account whose logs will be viewed")
                            .setAutocomplete(true)
                    )
                    .addUserOption((option) =>
                        option
                            .setName("user")
                            .setDescription("The customer whose logs will be viewed")
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("status")
                    .setDescription("Changes an account's status")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account to update")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("status")
                            .setDescription("The account's new status")
                            .setRequired(true)
                            .addChoices(
                                { name: "Active", value: "ACTIVE" },
                                { name: "Frozen", value: "FROZEN" },
                                { name: "Closed", value: "CLOSED" }
                            )
                    )
                    .addStringOption((option) =>
                        option
                            .setName("reason")
                            .setDescription("The reason for changing the account status")
                            .setRequired(true)
                            .setMinLength(1)
                            .setMaxLength(500)
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
        const command = interaction.options.getSubcommand()

        if (!await hasStaffCommandAccess(interaction.client, interaction.user.id, command)) {
            return interaction.reply({ ...message("Staff access required", "Your role in the main server does not allow this staff command.", "STAFF_ACCESS_REQUIRED"), flags: MessageFlags.Ephemeral })
        }

        switch(command) {
            case "logs": {
                const accountNumber = interaction.options.getString("account")
                const discordUser = interaction.options.getUser("user")

                if ((!accountNumber && !discordUser) || (accountNumber && discordUser)) {
                    return interaction.reply({ ...message("Choose one log source", "Select either an account or a customer whose audit logs you want to view.", "AUDIT_SCOPE_REQUIRED"), flags: MessageFlags.Ephemeral })
                }

                if (discordUser) {
                    const user = await User.findOne({
                        attributes: ["id", "discordId", "robloxName"],
                        where: { discordId: discordUser.id }
                    })

                    if (!user) {
                        return interaction.reply({ ...message("Customer not found", "The selected user does not have a customer profile.", "CUSTOMER_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                    }

                    return interaction.reply({
                        ...await auditLogPage({
                            where: { userId: user.id },
                            requestedPage: 0,
                            buttonBase: `staffaudit_user_${user.id}_${interaction.user.id}`,
                            title: "Customer audit logs",
                            description: `Actions recorded for ${discordUser}.`,
                            footer: "Customer audit logs",
                            showActor: false,
                            showAccount: true
                        }),
                        flags: MessageFlags.Ephemeral
                    })
                }

                const account = await accountFromNumber(accountNumber)

                if (!account) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and try again.", "ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({
                    ...await auditLogPage({
                        where: { accountId: account.id },
                        requestedPage: 0,
                        buttonBase: `staffaudit_account_${account.id}_${interaction.user.id}`,
                        title: "Account audit logs",
                        description: `Recorded activity for **${account.name}**.`,
                        footer: `Account: ${formatAccountNumber(account.number)}`,
                        showActor: true,
                        showAccount: false
                    }),
                    flags: MessageFlags.Ephemeral
                })
            }

            case "transactions": {
                const accountNumber = interaction.options.getString("account")
                const transactionId = interaction.options.getString("id")
                const account = await accountFromNumber(accountNumber)

                if (!account) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and try again.", "ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                if (transactionId) {
                    const transaction = await accountTransactionDetails(account, transactionId, true)

                    if (!transaction) {
                        return interaction.reply({ ...message("Transaction not found", "No transaction with that ID was found for this account.", "TRANSACTION_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                    }

                    return interaction.reply({ ...transaction, flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({
                    ...await accountTransactionsPage(account, 0, interaction.user.id, "stafftransactions", true),
                    flags: MessageFlags.Ephemeral
                })
            }

            case "status": {
                const accountNumber = interaction.options.getString("account")
                const status = interaction.options.getString("status")
                const reason = interaction.options.getString("reason")
                const account = await accountFromNumber(accountNumber)

                if (!account) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and try again.", "ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const actor = await userFromDiscord(interaction.user.id)

                if (!actor) {
                    return interaction.reply({ ...message("Staff profile required", "Your staff account is not linked to a customer profile.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                try {
                    await setAccountStatus(actor, account, status, reason, { notifyAudit: true })
                } catch (error) {
                    console.error("Staff failed to update account status!", error)

                    if (error?.message === `ACCOUNT_ALREADY_${status}`) {
                        return interaction.reply({ ...message("Status unchanged", `This account is already ${status.toLowerCase()}.`, error.message), flags: MessageFlags.Ephemeral })
                    }

                    return interaction.reply({ ...message("Status not updated", "We could not update this account's status. Please try again.", "ACCOUNT_STATUS_UPDATE_FAILED"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ ...message("Account status updated", `**Account:** ${account.name} (${formatAccountNumber(account.number)})\n**Status:** ${status}\n**Reason:** ${reason.trim()}`), flags: MessageFlags.Ephemeral })
            }

            case "access": {
                const accountNumber = interaction.options.getString("account")
                const discordUser = interaction.options.getUser("user")
                const requestedAccess = interaction.options.getInteger("role")
                const roleName = Object.entries(config.accountAccesses)
                    .find(([, access]) => access === requestedAccess)?.[0]

                if (!roleName) {
                    return interaction.reply({ ...message("Role not recognised", "Choose one of the available account roles and try again.", "INVALID_ACCOUNT_ROLE"), flags: MessageFlags.Ephemeral })
                }

                const account = await accountFromNumber(accountNumber)

                if (!account) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and try again.", "ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const [actor, target] = await Promise.all([
                    userFromDiscord(interaction.user.id),
                    userFromDiscord(discordUser.id)
                ])

                if (!actor) {
                    return interaction.reply({ ...message("Staff profile required", "Your staff account is not linked to a customer profile.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                if (!target) {
                    return interaction.reply({ ...message("Customer not found", "The selected user must complete registration before account access can be assigned.", "CUSTOMER_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                try {
                    await setAccountAccess(actor, target, account, requestedAccess, {
                        bypassLimits: true,
                        bypassStatus: true,
                        notifyAudit: true
                    })
                } catch (error) {
                    console.error("Staff failed to update account access!", error)

                    return interaction.reply({ ...message("Access not updated", "We could not update this customer's account access. Please try again.", "ACCESS_UPDATE_FAILED"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ ...message("Access updated", `${discordUser} now has the **${roleName}** role for **${account.name}**.`), flags: MessageFlags.Ephemeral })
            }

            case "embed": {
                const channel = interaction.options.getChannel("channel") || interaction.channel
                const selectedEmbed = interaction.options.getString("embed")
                const templates = { register }

                await channel.send(templates[selectedEmbed])

                return interaction.reply({ ...message("Message sent", `The message was published in <#${channel.id}>.`), flags: MessageFlags.Ephemeral })
            }

            case "deposit": {
                const reserve = interaction.options.getString("reserve")
                const account = interaction.options.getString("account")
                const rawAmount = interaction.options.getNumber("amount")
                const currency = interaction.options.getString("currency")

                const reserveAccount = await accountFromNumber(reserve)

                if (!reserveAccount || reserveAccount.type !== "Reserve") {
                    return interaction.reply({ ...message("Reserve account unavailable", "Check the reserve account number and try again.", "RESERVE_ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const receivingAccount = await accountFromNumber(account)

                if (!receivingAccount || receivingAccount.type === "Reserve") {
                    return interaction.reply({ ...message("Receiving account unavailable", "Choose a valid customer account and try again.", "RECEIVING_ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Staff profile required", "Your staff account is not linked to a customer profile.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                let ledger

                try {
                    ledger = await transfer(reserveAccount, receivingAccount, rawAmount, currency, "Account Deposit", user, {
                        overdraft: true,
                        bypassStatus: true,
                        notifyAudit: true,
                        ledgerType: "DEPOSIT",
                        auditAction: "DEPOSIT_COMPLETED"
                    })
                } catch (error) {
                    console.error("Failed to deposit!", error)
                    return interaction.reply({ ...depositErrorMessage(error), flags: MessageFlags.Ephemeral })
                }

                void notifyIncomingPayment(interaction.client, receivingAccount, {
                    amount: ledger.amount,
                    currency,
                    reference: "Account Deposit",
                    transactionId: ledger.uuid
                })

                return interaction.reply({ ...message("Deposit complete", `**Amount:** ${currency} ${formatCurrency(ledger.amount)}\n**Reserve:** ${formatAccountNumber(reserve)}\n**Receiving account:** ${formatAccountNumber(account)}`, undefined, `Transaction ID: ${ledger.uuid}`), flags: MessageFlags.Ephemeral })
            }

            case "withdraw": {
                const reserve = interaction.options.getString("reserve")
                const account = interaction.options.getString("account")
                const rawAmount = interaction.options.getNumber("amount")
                const currency = interaction.options.getString("currency")

                const [reserveAccount, customerAccount, user] = await Promise.all([
                    accountFromNumber(reserve),
                    accountFromNumber(account),
                    userFromDiscord(interaction.user.id)
                ])
                if (!reserveAccount || reserveAccount.type !== "Reserve") {
                    return interaction.reply({ ...message("Reserve account unavailable", "Check the reserve account number and try again.", "RESERVE_ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                if (!customerAccount || customerAccount.type === "Reserve") {
                    return interaction.reply({ ...message("Customer account unavailable", "Choose a valid customer account and try again.", "CUSTOMER_ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                if (!user) {
                    return interaction.reply({ ...message("Staff profile required", "Your staff account is not linked to a customer profile.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                let ledger
                try {
                    ledger = await transfer(customerAccount, reserveAccount, rawAmount, currency, "Account Withdrawal", user, {
                        bypassStatus: true,
                        notifyAudit: true,
                        ledgerType: "WITHDRAWAL",
                        auditAction: "WITHDRAWAL_COMPLETED"
                    })
                } catch (error) {
                    console.error("Failed to withdraw!", error)
                    return interaction.reply({ ...withdrawalErrorMessage(error), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ ...message("Withdrawal complete", `**Amount:** ${currency} ${formatCurrency(ledger.amount)}\n**Customer account:** ${formatAccountNumber(account)}\n**Reserve:** ${formatAccountNumber(reserve)}`, undefined, `Transaction ID: ${ledger.uuid}`), flags: MessageFlags.Ephemeral })
            }

            case "open": {
                const type = interaction.options.getString("type")
                const holder = interaction.options.getUser("holder")
                const name = interaction.options.getString("name")

                const [user, actor] = await Promise.all([
                    userFromDiscord(holder.id),
                    userFromDiscord(interaction.user.id)
                ])

                if (!user) {
                    return interaction.reply({ ...message("Customer not found", "The selected user must complete registration before an account can be opened.", "CUSTOMER_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                if (!actor) {
                    return interaction.reply({ ...message("Staff profile required", "Your staff account is not linked to a customer profile.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const account = await createAccount(user, type, name, {
                    notifyAudit: true,
                    auditActor: actor
                })

                if (!account) {
                    return interaction.reply({ ...message("Account not opened", "We could not open the account. Check the details and try again.", "ACCOUNT_OPEN_FAILED"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ ...message("Account opened", `**Name:** ${account.name}\n**Number:** ${formatAccountNumber(account.number)}\n**Type:** ${account.type}\n**Status:** ${account.status}`), flags: MessageFlags.Ephemeral })
            }
        }
    },

    autocomplete: async (interaction) => {
        const command = interaction.options.getSubcommand()

        if (!await hasStaffCommandAccess(interaction.client, interaction.user.id, command)) {
            return interaction.respond([])
        }

        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "account":
            case "reserve": {
                const filtersByDepositType = command === "deposit" || command === "withdraw"
                const reserveOnly = focused.name === "reserve"
                const accountFilters = filtersByDepositType
                    ? [
                        reserveOnly
                            ? { type: "Reserve" }
                            : { type: { [Op.ne]: "Reserve" } }
                    ]
                    : []

                const accounts = await Account.findAll({
                    attributes: ["name", "number", "status", "type"],
                    where: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                        ...accountFilters
                    ],

                    limit: 25
                })

		        await interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - ${account.status} - (${formatAccountNumber(account.number)})`, value: account.number })))
            }
        }
    }
}
