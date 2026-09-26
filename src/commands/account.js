import {
    ActionRowBuilder,
    ApplicationIntegrationType,
    ButtonBuilder,
    ButtonStyle,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder
} from "discord.js"
import { Account, AccountBalance, PaymentRequestBlock, User, Withdrawal } from "#models/models"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import { accountFromNumber, getAccountAccess, hasAccountAccess, transfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import message from "#functions/templates/message"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import { accountTransactionDetails, accountTransactionsPage } from "#functions/util/accountTransactions"
import { auditLogPage } from "#functions/util/auditLogs"
import { currentWeekAccountActivity } from "#functions/util/accountActivity"
import { createPaymentRequest, unblockPaymentRequests } from "#functions/db/paymentRequest"

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
                    .setName("deposit")
                    .setDescription("Request a deposit into one of your accounts")
                    .addStringOption(option => option
                        .setName("account")
                        .setDescription("The account to deposit into")
                        .setRequired(true)
                        .setAutocomplete(true))
                    .addNumberOption(option => option
                        .setName("amount")
                        .setDescription("The requested deposit amount")
                        .setRequired(true))
                    .addStringOption(option => option
                        .setName("currency")
                        .setDescription("The requested currency")
                        .setRequired(true)
                        .addChoices(config.currencies.map(currency => ({ name: currency, value: currency }))))
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
                        .setDescription("The requested currency")
                        .setRequired(true)
                        .addChoices(config.currencies.map(currency => ({ name: currency, value: currency }))))
            )

            .addSubcommandGroup(group => group
                .setName("request")
                .setDescription("Request a payment from another customer")
                .addSubcommand(subcommand => subcommand
                    .setName("send")
                    .setDescription("Send a payment request")
                    .addStringOption(option => option
                        .setName("account")
                        .setDescription("The account that will receive the payment")
                        .setRequired(true)
                        .setAutocomplete(true))
                    .addUserOption(option => option
                        .setName("user")
                        .setDescription("The customer to request payment from")
                        .setRequired(true))
                    .addNumberOption(option => option
                        .setName("amount")
                        .setDescription("The amount to request")
                        .setRequired(true))
                    .addStringOption(option => option
                        .setName("currency")
                        .setDescription("The currency to request")
                        .setRequired(true)
                        .addChoices(config.currencies.map(currency => ({ name: currency, value: currency }))))
                    .addStringOption(option => option
                        .setName("reference")
                        .setDescription("The payment reference")
                        .setMinLength(1)
                        .setMaxLength(18)))
                .addSubcommand(subcommand => subcommand
                    .setName("unblock")
                    .setDescription("Allow an account to send you payment requests again")
                    .addStringOption(option => option
                        .setName("account")
                        .setDescription("The previously blocked requesting account")
                        .setRequired(true)
                        .setAutocomplete(true)))),

    cooldown: 0,
    scope: "global",

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()

        switch(command) {
            case "send": {
                const requester = await userFromDiscord(interaction.user.id)
                const discordTarget = interaction.options.getUser("user")
                if (!requester) {
                    return interaction.reply({ ...message("Profile required", "Complete registration before sending payment requests.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                if (!discordTarget || discordTarget.bot || discordTarget.id === interaction.user.id) {
                    return interaction.reply({ ...message("Customer unavailable", "Choose another registered customer.", "PAYMENT_REQUEST_TARGET_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const [target, receivingAccount] = await Promise.all([
                    User.findOne({ attributes: ["id", "discordId"], where: { discordId: discordTarget.id, robloxId: { [Op.ne]: null } } }),
                    accountFromNumber(interaction.options.getString("account"))
                ])
                if (!target) {
                    return interaction.reply({ ...message("Customer unavailable", "That user does not have a registered customer profile.", "PAYMENT_REQUEST_TARGET_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                let request
                try {
                    request = await createPaymentRequest(
                        requester,
                        target,
                        receivingAccount,
                        interaction.options.getNumber("amount"),
                        interaction.options.getString("currency"),
                        interaction.options.getString("reference")
                    )
                } catch (error) {
                    if (error?.message === "PAYMENT_REQUEST_BLOCKED") {
                        return interaction.reply({ ...message("Request blocked", "This account cannot send payment requests to that customer.", "PAYMENT_REQUEST_BLOCKED"), flags: MessageFlags.Ephemeral })
                    }
                    if (error?.message === "INVALID_AMOUNT" || error?.message === "INVALID_PAYMENT_REQUEST") {
                        return interaction.reply({ ...message("Invalid payment request", "Enter a positive amount with no more than two decimal places and a valid reference.", error.message), flags: MessageFlags.Ephemeral })
                    }
                    return interaction.reply({ ...message("Request not sent", "Check the account and make sure you have Signatory access, then try again.", "PAYMENT_REQUEST_FAILED"), flags: MessageFlags.Ephemeral })
                }

                const notification = {
                    ...message(
                        "Payment requested",
                        `**From:** ${receivingAccount.name} (${formatAccountNumber(receivingAccount.number)})\n**Amount:** ${request.currency} ${formatCurrency(request.amount)}\n**Reference:** ${request.reference}\n\nAccept to choose one of your accounts to pay from. Blocking stops this account from sending you more payment requests.`,
                        undefined,
                        `Request #${request.id}`
                    ),
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`request_${request.id}_accept`).setLabel("Accept").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`request_${request.id}_deny`).setLabel("Deny").setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`request_${request.id}_block`).setLabel("Block account").setStyle(ButtonStyle.Danger)
                    )],
                    allowedMentions: { parse: [] }
                }

                try {
                    const dm = await discordTarget.send(notification)
                    await request.update({ messageId: dm.id })
                } catch (error) {
                    console.error(`Could not DM payment request ${request.id}:`, error)
                    await request.update({ status: "CANCELLED" }).catch(console.error)
                    return interaction.reply({ ...message("Request not delivered", "The customer could not be sent a DM. No payment request remains active.", "PAYMENT_REQUEST_DM_FAILED"), flags: MessageFlags.Ephemeral })
                }

                return interaction.reply({ ...message("Payment request sent", `${discordTarget} was asked to pay **${request.currency} ${formatCurrency(request.amount)}** to **${receivingAccount.name}**.`, undefined, `Request #${request.id}`), flags: MessageFlags.Ephemeral })
            }

            case "unblock": {
                const target = await userFromDiscord(interaction.user.id)
                const requestingAccount = await accountFromNumber(interaction.options.getString("account"))
                if (!target) {
                    return interaction.reply({ ...message("Profile required", "Complete registration before managing blocked requests.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                try {
                    await unblockPaymentRequests(target, requestingAccount)
                } catch (error) {
                    return interaction.reply({ ...message("Block not found", "That account is not currently blocked from sending you payment requests.", "PAYMENT_REQUEST_BLOCK_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                return interaction.reply({ ...message("Account unblocked", `**${requestingAccount.name}** can send you payment requests again.`), flags: MessageFlags.Ephemeral })
            }

            case "deposit":
            case "withdraw": {
                const type = command === "deposit" ? "DEPOSIT" : "WITHDRAWAL"
                const currency = interaction.options.getString("currency")
                const amount = interaction.options.getNumber("amount")
                const user = await userFromDiscord(interaction.user.id)

                if (!user) {
                    return interaction.reply({ ...message("Profile required", "We could not find your customer profile. Please complete registration or contact support.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                if (!Number.isFinite(amount) || amount <= 0 || amount >= 100000000 || Number(amount.toFixed(2)) !== amount) {
                    return interaction.reply({ ...message("Invalid amount", "Enter an amount greater than zero, with no more than two decimal places.", "INVALID_AMOUNT"), flags: MessageFlags.Ephemeral })
                }

                const account = await accountFromNumber(interaction.options.getString("account"))
                if (!account || account.type === "Reserve" || !await hasAccountAccess(user, account, config.accountAccesses.Signatory)) {
                    return interaction.reply({ ...message("Account unavailable", "Choose a customer account where you have Signatory access.", "REQUEST_ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }
                if (account.status !== "ACTIVE") {
                    return interaction.reply({ ...message("Request unavailable", "This account cannot currently make deposit or withdrawal requests.", `ACCOUNT_${account.status}`), flags: MessageFlags.Ephemeral })
                }

                await interaction.deferReply({ flags: MessageFlags.Ephemeral })
                let request
                let staffMessage
                try {
                    const channel = await interaction.client.channels.fetch(config.requestChannelId || config.withdrawalChannelId)
                    if (!channel || typeof channel.send !== "function") throw new Error("REQUEST_CHANNEL_UNAVAILABLE")

                    request = await Withdrawal.create({
                        requesterId: user.id,
                        accountId: account.id,
                        amount,
                        currency,
                        type,
                        status: "PENDING"
                    })
                    const label = type === "DEPOSIT" ? "Deposit" : "Withdrawal"
                    const notification = message(`${label} requested`, `**Customer:** <@${interaction.user.id}>\n**Account:** ${account.name} (${formatAccountNumber(account.number)})\n**Amount:** ${currency} ${formatCurrency(amount)}\n**Status:** Pending`, undefined, `Request #${request.id}`)
                    notification.allowedMentions = { parse: [] }
                    notification.components = [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`cashrequest_${request.id}_complete`).setLabel("Complete").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`cashrequest_${request.id}_decline`).setLabel("Decline").setStyle(ButtonStyle.Danger)
                    )]
                    staffMessage = await channel.send(notification)
                    await request.update({ messageId: staffMessage.id })
                } catch (error) {
                    console.error(`Failed to submit ${type.toLowerCase()} request:`, error)
                    if (request) await request.update({ status: "CANCELLED" }).catch(console.error)
                    if (staffMessage) await staffMessage.delete().catch(console.error)
                    return interaction.editReply(message("Request not submitted", "The staff request could not be delivered. No money was moved.", "ACCOUNT_REQUEST_FAILED"))
                }

                const label = type === "DEPOSIT" ? "Deposit" : "Withdrawal"
                return interaction.editReply(message(`${label} requested`, `Your request for **${currency} ${formatCurrency(amount)}** involving **${account.name}** was sent to staff. This request does not move money by itself.`, undefined, `Request #${request.id}`))
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


        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "from":
            case "account": {
                const command = interaction.options.getSubcommand()
                const requestGroup = interaction.options.getSubcommandGroup(false) === "request"

                if (requestGroup && command === "unblock") {
                    const user = await User.findOne({ attributes: ["id"], where: { discordId: interaction.user.id } })
                    if (!user) return interaction.respond([])
                    const blocks = await PaymentRequestBlock.findAll({
                        attributes: ["requestingAccountId"],
                        where: { blockedUserId: user.id },
                        include: [{
                            model: Account,
                            as: "requestingAccount",
                            attributes: ["name", "number", "type"],
                            where: { [Op.or]: [
                                { number: { [Op.like]: `%${focused.value}%` } },
                                { name: { [Op.like]: `%${focused.value}%` } }
                            ] }
                        }],
                        limit: 25
                    })
                    return interaction.respond(blocks.map(block => ({
                        name: `${block.requestingAccount.name} - ${block.requestingAccount.type} - (${formatAccountNumber(block.requestingAccount.number)})`,
                        value: block.requestingAccount.number
                    })))
                }

                const cashRequest = command === "deposit" || command === "withdraw"
                const requiredAccess = focused.name === "from" || cashRequest || (requestGroup && command === "send")
                    ? config.accountAccesses.Signatory
                    : config.accountAccesses.Viewer
                const statusFilter = focused.name === "from" || cashRequest || (requestGroup && command === "send")
                    ? { status: "ACTIVE" }
                    : undefined
                const accounts = await Account.findAll({
                    attributes: ["name", "number", "type"],
                    where: {[Op.and]: [
                        {[Op.or]: [
                            { number: { [Op.like]: `%${focused.value}%` } },
                            { name: { [Op.like]: `%${focused.value}%` } }
                        ]},
                        ...(statusFilter ? [statusFilter] : []),
                        ...(cashRequest ? [{ type: { [Op.ne]: "Reserve" } }] : [])
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
