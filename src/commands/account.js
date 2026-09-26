import {
    ActionRowBuilder,
    ApplicationIntegrationType,
    ButtonBuilder,
    ButtonStyle,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder
} from "discord.js"
import { Account, AccountBalance, User, Withdrawal } from "#models/models"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import { accountFromNumber, getAccountAccess, hasAccountAccess, removeAccountAccess, setAccountAccess, transfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import message from "#functions/templates/message"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import { accountTransactionDetails, accountTransactionsPage } from "#functions/util/accountTransactions"
import { auditLogPage } from "#functions/util/auditLogs"
import { currentWeekAccountActivity } from "#functions/util/accountActivity"

const REMOVE_ACCOUNT_ACCESS = 0

function transferErrorMessage(error) {
    switch (error?.message) {
        case "SAME_ACCOUNT":
            return message("Transfer not completed", "Choose two different accounts and try again.", "SAME_ACCOUNT")
        case "ACCOUNT_FROZEN":
            return message("Transfer not completed", "One of the accounts cannot currently send or receive transfers. Please contact support if you need help.", "ACCOUNT_FROZEN")
        case "ACCOUNT_CLOSED":
            return message("Transfer not completed", "Closed accounts cannot send or receive transfers. Check the account details or contact support.", "ACCOUNT_CLOSED")
        case "INVALID_AMOUNT":
            return message("Transfer not completed", "Enter an amount greater than zero, using no more than two decimal places.", "INVALID_AMOUNT")
        case "INSUFFICIENT_FUNDS":
            return message("Transfer not completed", "The sending account does not have enough funds in the selected currency.", "INSUFFICIENT_FUNDS")
        default:
            return message("Transfer not completed", "We could not complete the transfer. No money was moved. Please try again or contact support.", "TRANSFER_FAILED")
    }
}

function accessName(access) {
    return Object.entries(config.accountAccesses)
        .find(([, value]) => value === Number(access))?.[0] || "Custom"
}

function accessFields(users, currentDiscordId) {
    const allLines = users
        .filter(user => user.discordId && user.discordId !== currentDiscordId)
        .sort((first, second) => Number(second.accountAccess?.access) - Number(first.accountAccess?.access))
        .map(user => `${user.robloxName ? `**${user.robloxName}** ` : ""}(<@${user.discordId}>) — ${accessName(user.accountAccess?.access)}`)
    const lines = allLines.slice(0, 50)

    if (allLines.length > lines.length) {
        lines.push(`*And ${allLines.length - lines.length} more…*`)
    }

    if (!lines.length) {
        return [{ name: "Other account access", value: "No other customers have access." }]
    }

    const chunks = []

    for (const line of lines) {
        const current = chunks.at(-1)

        if (!current || `${current}\n${line}`.length > 1024) {
            chunks.push(line)
        } else {
            chunks[chunks.length - 1] = `${current}\n${line}`
        }
    }

    return chunks.map((value, index) => ({
        name: index === 0 ? "Other account access" : `Other account access (${index + 1})`,
        value
    }))
}

function activityText(totals) {
    return totals.length
        ? totals.map(total => `**${total.currency}:** ${formatCurrency(total.total)}`).join("\n")
        : "No activity"
}

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
                    .setName("info")
                    .setDescription("Views the details of one of your accounts")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account to view")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("transactions")
                    .setDescription("Views recent transactions for one of your accounts")
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
                    .setDescription("Views your personal or account audit logs")
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("An account whose logs you can view (optional)")
                            .setAutocomplete(true)
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
                    .setName("withdraw")
                    .setDescription("Request a withdrawal from one of your accounts")
                    .addStringOption(option => option
                        .setName("account")
                        .setDescription("The account to withdraw from")
                        .setRequired(true)
                        .setAutocomplete(true))
                    .addNumberOption(option => option
                        .setName("amount")
                        .setDescription("The amount to withdraw")
                        .setRequired(true))
                    .addStringOption(option => option
                        .setName("currency")
                        .setDescription("The requested currency (HC$ only for now)")
                        .addChoices(config.currencies.map(currency => ({ name: currency, value: currency }))))
            )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("access")
                    .setDescription("Sets or removes a user's access to an account")
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
                            .setDescription("The user's account role, or Remove to revoke access")
                            .setRequired(true)
                            .addChoices(
                                ...Object.entries(config.accountAccesses)
                                    .filter(([name]) => name !== "Holder")
                                    .map(([name, value]) => ({ name, value })),
                                { name: "Remove", value: REMOVE_ACCOUNT_ACCESS }
                            )
                    )
            ),

    cooldown: 0,
    scope: "global",

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()

        switch(command) {
            case "withdraw": {
                const currency = interaction.options.getString("currency") || "HC$"

                if (currency !== "HC$") {
                    return interaction.reply({ ...message("Currency unavailable", "Withdrawals in that currency are not available right now. Please choose HC$.", "WITHDRAWAL_CURRENCY_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const amount = interaction.options.getNumber("amount")

                if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000000 || Number(amount.toFixed(2)) !== amount) {
                    return interaction.reply({ ...message("Invalid amount", "Enter an HC$ amount greater than zero, with no more than two decimal places.", "INVALID_AMOUNT"), flags: MessageFlags.Ephemeral })
                }

                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const account = await accountFromNumber(interaction.options.getString("account"))

                if (!account || !await hasAccountAccess(user, account, config.accountAccesses.Signatory)) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and make sure you are authorised to withdraw from it.", "WITHDRAWAL_ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                if (account.status !== "ACTIVE") {
                    return interaction.reply({ ...message("Withdrawal unavailable", "This account cannot currently make withdrawals. Please contact support.", `ACCOUNT_${account.status}`), flags: MessageFlags.Ephemeral })
                }

                const balance = await AccountBalance.findOne({ where: { accountId: account.id, currency } })

                if (!balance || Number(balance.balance) < amount) {
                    return interaction.reply({ ...message("Insufficient funds", "This account does not have enough HC$ for the requested withdrawal.", "INSUFFICIENT_FUNDS"), flags: MessageFlags.Ephemeral })
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral })
                let request
                let staffMessage

                try {
                    const channel = await interaction.client.channels.fetch(config.withdrawalChannelId)

                    if (!channel || typeof channel.send !== "function") throw new Error("WITHDRAWAL_CHANNEL_UNAVAILABLE")

                    request = await Withdrawal.create({
                        requesterId: user.id,
                        accountId: account.id,
                        amount,
                        currency,
                        status: "PENDING"
                    })

                    const notification = message("Withdrawal requested", `**Customer:** <@${interaction.user.id}>\n**Account:** ${account.name} (${formatAccountNumber(account.number)})\n**Amount:** HC$ ${formatCurrency(amount)}\n**Status:** Pending`, undefined, `Request #${request.id}`)
                    notification.allowedMentions = { parse: [] }
                    notification.components = [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`withdraw_${request.id}_complete`).setLabel("Complete").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`withdraw_${request.id}_cancel`).setLabel("Cancel").setStyle(ButtonStyle.Danger)
                    )]
                    staffMessage = await channel.send(notification)
                    await request.update({ messageId: staffMessage.id })
                } catch (error) {
                    console.error("Failed to submit withdrawal request:", error)
                    if (request) await request.update({ status: "CANCELLED" }).catch(console.error)
                    if (staffMessage) await staffMessage.delete().catch(console.error)
                    return interaction.editReply(message("Request not submitted", "We could not submit your withdrawal request. No money was moved. Please try again or contact support.", "WITHDRAWAL_REQUEST_FAILED"))
                }

                return interaction.editReply(message("Withdrawal requested", `Your request for **HC$ ${formatCurrency(amount)}** from **${account.name}** has been sent to staff. You will receive a DM when it is completed or cancelled, if your DMs are open.`, undefined, `Request #${request.id}`))
            }

            case "logs": {
                const accountNumber = interaction.options.getString("account")
                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                if (!accountNumber) {
                    return interaction.reply({
                        ...await auditLogPage({
                            where: { userId: user.id },
                            requestedPage: 0,
                            buttonBase: `audit_user_${user.id}_${interaction.user.id}`,
                            title: "Your audit logs",
                            description: "Actions recorded for your customer profile.",
                            footer: "Personal audit logs",
                            showActor: false,
                            showAccount: true
                        }),
                        flags: MessageFlags.Ephemeral
                    })
                }

                const account = await accountFromNumber(accountNumber)

                if (!account || !await hasAccountAccess(user, account, config.accountAccesses.Viewer)) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and make sure you have permission to view its audit logs.", "ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({
                    ...await auditLogPage({
                        where: { accountId: account.id },
                        requestedPage: 0,
                        buttonBase: `audit_account_${account.id}_${interaction.user.id}`,
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
                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const account = await accountFromNumber(accountNumber)

                if (!account || !await hasAccountAccess(user, account, config.accountAccesses.Viewer)) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and make sure you have permission to view this account.", "ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                if (transactionId) {
                    const transaction = await accountTransactionDetails(account, transactionId)

                    if (!transaction) {
                        return interaction.reply({ ...message("Transaction not found", "No transaction with that ID was found for this account.", "TRANSACTION_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                    }

                    return interaction.reply({ ...transaction, flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({
                    ...await accountTransactionsPage(account, 0, interaction.user.id),
                    flags: MessageFlags.Ephemeral
                })
            }

            case "info": {
                const accountNumber = interaction.options.getString("account")
                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const selectedAccount = await accountFromNumber(accountNumber)
                const access = await getAccountAccess(user, selectedAccount)

                if (!selectedAccount || access === null || access < config.accountAccesses.Viewer) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and make sure you have permission to view this account.", "ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const [balances, accountUsers, weeklyActivity] = await Promise.all([
                    selectedAccount.getAccountBalances({
                        attributes: ["balance", "currency"],
                        order: [["currency", "ASC"]]
                    }),
                    selectedAccount.getUsers({
                        attributes: ["discordId", "robloxName"],
                        through: { attributes: ["access"] }
                    }),
                    currentWeekAccountActivity(selectedAccount.id)
                ])
                const createdAt = Math.floor(selectedAccount.createdAt.getTime() / 1000)
                const updatedAt = Math.floor(selectedAccount.updatedAt.getTime() / 1000)
                const balanceText = balances.length
                    ? balances.map(balance => `**${balance.currency}:** ${formatCurrency(balance.balance)}`).join("\n")
                    : "No balances held"
                const response = message(
                    "Account information",
                    `Details for **${selectedAccount.name}**`,
                    undefined
                )

                response.embeds[0].addFields(
                    {
                        name: "Account",
                        value: `**Number:** ${formatAccountNumber(selectedAccount.number)}\n**Type:** ${selectedAccount.type}\n**Status:** ${selectedAccount.status}`,
                        inline: true
                    },
                    {
                        name: "Your access",
                        value: accessName(access),
                        inline: true
                    },
                    {
                        name: "Balances",
                        value: balanceText
                    },
                    {
                        name: "Incoming · This week",
                        value: activityText(weeklyActivity.incoming),
                        inline: true
                    },
                    {
                        name: "Outgoing · This week",
                        value: activityText(weeklyActivity.outgoing),
                        inline: true
                    },
                    ...accessFields(accountUsers, interaction.user.id),
                    {
                        name: "Dates",
                        value: `**Opened:** <t:${createdAt}:F>\n**Last updated:** <t:${updatedAt}:F>`
                    }
                )

                return interaction.reply({ ...response, allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral })
            }

            case "balance": {
                const account = interaction.options.getString("account")
                const show = interaction.options.getBoolean("show")
                const currency = interaction.options.getString("currency")

                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const selectedAccount = await accountFromNumber(account)

                if (!selectedAccount || !await hasAccountAccess(user, selectedAccount, config.accountAccesses.Viewer)) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and make sure you have permission to view this account.", "ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const balances = await selectedAccount.getAccountBalances({
                    attributes: ["balance", "currency"],
                    where: currency ? { currency } : undefined
                })


                if (balances.length === 0) {
                    return interaction.reply({ ...message("No balance found", "This account does not hold a balance in the selected currency.", "BALANCE_NOT_FOUND", `Account: ${formatAccountNumber(account)}`), flags: show ? undefined : MessageFlags.Ephemeral })
                }

                const balanceText = balances.map(balance => `${balance.currency} ${formatCurrency(balance.balance)}`).join("\n")

                return interaction.reply({ ...message("Account balance", balanceText, undefined, `Account: ${formatAccountNumber(account)}`), flags: show ? undefined : MessageFlags.Ephemeral })
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
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const fromAccount = await accountFromNumber(from)

                if (!fromAccount || !await hasAccountAccess(user, fromAccount, config.accountAccesses.Signatory)) {
                    return interaction.reply({ ...message("Sending account unavailable", "Check the account number and make sure you are authorised to send payments from it.", "SENDING_ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const toAccount = await accountFromNumber(to)

                if (!toAccount) {
                    return interaction.reply({ ...message("Receiving account unavailable", "Check the receiving account number and try again.", "RECEIVING_ACCOUNT_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                let ledger

                try {
                    ledger = await transfer(fromAccount, toAccount, rawAmount, currency, reference, user)
                } catch (error) {
                    console.error("Failed to complete transfer:", error)
                    return interaction.reply({ ...transferErrorMessage(error), flags: MessageFlags.Ephemeral })
                }

                void notifyIncomingPayment(interaction.client, toAccount, {
                    amount: ledger.amount,
                    currency,
                    reference,
                    transactionId: ledger.uuid
                })

                return interaction.reply({ ...message("Transfer complete", `**Amount:** ${currency} ${formatCurrency(ledger.amount)}\n**From:** ${formatAccountNumber(from)}\n**To:** ${formatAccountNumber(to)}`, undefined, `Transaction ID: ${ledger.uuid}`), flags: show ? undefined : MessageFlags.Ephemeral })
            }

            case "access": {
                const accountNumber = interaction.options.getString("account")
                const discordUser = interaction.options.getUser("user")
                const requestedAccess = interaction.options.getInteger("role")
                const removeAccess = requestedAccess === REMOVE_ACCOUNT_ACCESS
                const roleName = Object.entries(config.accountAccesses)
                    .find(([, access]) => access === requestedAccess)?.[0]
                const selectedAccount = await accountFromNumber(accountNumber)
                const actor = await userFromDiscord(interaction.user.id)

                if (!removeAccess && !roleName) {
                    return interaction.reply({ ...message("Role not recognised", "Choose one of the available account roles and try again.", "INVALID_ACCOUNT_ROLE"), flags: MessageFlags.Ephemeral })
                }

                if (!actor) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const actorAccess = await getAccountAccess(actor, selectedAccount)

                if (!selectedAccount || actorAccess === null || actorAccess < config.accountAccesses.Manager) {
                    return interaction.reply({ ...message("Account unavailable", "Check the account number and make sure you are authorised to manage access for this account.", "ACCOUNT_MANAGEMENT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                if (selectedAccount.status === "CLOSED") {
                    return interaction.reply({ ...message("Account closed", "Access roles can no longer be changed for this account.", "ACCOUNT_CLOSED"), flags: MessageFlags.Ephemeral })
                }

                const target = await userFromDiscord(discordUser.id)

                if (!target) {
                    return interaction.reply({ ...message("Customer not found", "The selected user does not have a customer profile yet.", "CUSTOMER_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const targetAccess = await getAccountAccess(target, selectedAccount)

                if (
                    requestedAccess === config.accountAccesses.Holder
                    || targetAccess === config.accountAccesses.Holder
                ) {
                    return interaction.reply({ ...message("Holder access protected", "Holder access cannot be added, changed, or removed with this command.", "HOLDER_ACCESS_RESTRICTED"), flags: MessageFlags.Ephemeral })
                }

                if (removeAccess && targetAccess !== null && targetAccess >= actorAccess) {
                    return interaction.reply({ ...message("Removal not permitted", "You can only remove customers with a lower access level than your own.", "ACCESS_LEVEL_RESTRICTED"), flags: MessageFlags.Ephemeral })
                }

                const managesElevatedAccess = requestedAccess >= config.accountAccesses.Manager
                    || targetAccess >= config.accountAccesses.Manager

                if (actorAccess < config.accountAccesses.Holder && managesElevatedAccess) {
                    return interaction.reply({ ...message("Holder approval required", "Only an account holder can add, change, or remove Manager access.", "HOLDER_APPROVAL_REQUIRED"), flags: MessageFlags.Ephemeral })
                }

                if (removeAccess) {
                    try {
                        await removeAccountAccess(actor, target, selectedAccount)
                    } catch (error) {
                        console.error("Failed to remove account access!", error)

                        if (error?.message === "ACCOUNT_ACCESS_NOT_FOUND") {
                            return interaction.reply({ ...message("No access found", "This customer does not currently have access to the account.", "ACCOUNT_ACCESS_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                        }

                        if (error?.message === "LAST_ACCOUNT_HOLDER") {
                            return interaction.reply({ ...message("Holder required", "The account's last Holder cannot be removed. Add another Holder first.", "LAST_ACCOUNT_HOLDER"), flags: MessageFlags.Ephemeral })
                        }

                        if (error?.message === "ACCOUNT_CLOSED") {
                            return interaction.reply({ ...message("Account closed", "Access roles can no longer be changed for this account.", "ACCOUNT_CLOSED"), flags: MessageFlags.Ephemeral })
                        }

                        return interaction.reply({ ...message("Access not removed", "We could not remove this customer's account access. Please try again or contact support.", "ACCESS_REMOVE_FAILED"), flags: MessageFlags.Ephemeral })
                    }

                    return interaction.reply({ ...message("Access removed", `${discordUser} no longer has access to **${selectedAccount.name}**.`), flags: MessageFlags.Ephemeral })
                }

                try {
                    await setAccountAccess(actor, target, selectedAccount, requestedAccess)
                } catch (error) {
                    console.error("Failed to update account access!", error)

                    if (error?.message === "ACCOUNT_ACCESS_NOT_ALLOWED") {
                        return interaction.reply({ ...message("Role unavailable", `**${selectedAccount.type}** accounts do not support the **${roleName}** role.`, "ACCOUNT_ACCESS_NOT_ALLOWED"), flags: MessageFlags.Ephemeral })
                    }

                    if (error?.message === "ACCOUNT_ACCESS_LIMIT_REACHED") {
                        return interaction.reply({ ...message("Access limit reached", `This account already has the maximum number of customers with the **${roleName}** role.`, "ACCOUNT_ACCESS_LIMIT_REACHED"), flags: MessageFlags.Ephemeral })
                    }

                    if (error?.message === "ACCOUNT_CLOSED") {
                        return interaction.reply({ ...message("Account closed", "Access roles can no longer be changed for this account.", "ACCOUNT_CLOSED"), flags: MessageFlags.Ephemeral })
                    }

                    return interaction.reply({ ...message("Access not updated", "We could not update this customer's account access. Please try again or contact support.", "ACCESS_UPDATE_FAILED"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ ...message("Access updated", `${discordUser} now has the **${roleName}** role for **${selectedAccount.name}**.`), flags: MessageFlags.Ephemeral })
            }
        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "from":
            case "account": {
                const command = interaction.options.getSubcommand()
                const requiredAccess = focused.name === "from" || command === "withdraw"
                    ? config.accountAccesses.Signatory
                    : command === "access"
                        ? config.accountAccesses.Manager
                        : config.accountAccesses.Viewer
                const statusFilter = focused.name === "from" || command === "withdraw"
                    ? { status: "ACTIVE" }
                    : command === "access"
                        ? { status: { [Op.ne]: "CLOSED" } }
                        : undefined
                const accounts = await Account.findAll({
                    attributes: ["name", "number", "type"],
                    where: {[Op.and]: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                        ...(statusFilter ? [statusFilter] : [])
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
