import {
    ActionRowBuilder,
    ApplicationIntegrationType,
    ButtonBuilder,
    ButtonStyle,
    InteractionContextType,
    MessageFlags,
    SlashCommandBuilder
} from "discord.js"
import { Account, AccountBalance, Pap, User } from "#models/models"
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
import manageAccountAccess, { REMOVE_ACCOUNT_ACCESS } from "#functions/util/manageAccountAccess"
import { authorizePap, editPap, revokePap } from "#functions/db/pap"

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

function papError(error) {
    const descriptions = {
        INVALID_AMOUNT: "Enter a positive weekly limit with no more than two decimal places.",
        INVALID_PAP: "Check the account numbers, currency, and weekly limit.",
        HOLDER_REQUIRED: "A Holder of the paying account must manage this PAP.",
        BUSINESS_ACCOUNT_REQUIRED: "The collecting account must be a business account.",
        PAP_UNAVAILABLE: "No active PAP exists between those accounts.",
        PAP_EXISTS: "An active PAP already exists between those accounts.",
        ACCOUNT_UNAVAILABLE: "One of the accounts is unavailable."
    }
    if (!(error?.message in descriptions)) console.error("Account PAP failed:", error)
    return { ...message("PAP not completed", descriptions[error?.message] || "Please try again or contact support.", error?.message in descriptions ? error.message : "PAP_FAILED"), flags: MessageFlags.Ephemeral }
}

async function managePap(interaction, action) {
    const actor = await userFromDiscord(interaction.user.id)
    if (!actor) return interaction.reply({ ...message("Profile required", "Complete registration before managing PAPs.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })

    try {
        if (action === "list") {
            const account = await accountFromNumber(interaction.options.getString("account"))
            if (!account || !await hasAccountAccess(actor, account, config.accountAccesses.Viewer)) throw new Error("ACCOUNT_UNAVAILABLE")
            const paps = await Pap.findAll({
                where: { [Op.or]: [{ payorId: account.id }, { payeeId: account.id }] },
                include: [
                    { model: Account, as: "payor", attributes: ["name", "number"] },
                    { model: Account, as: "payee", attributes: ["name", "number"] }
                ],
                order: [["createdAt", "DESC"]], limit: 10
            })
            const description = paps.length
                ? paps.map(pap => {
                    const other = String(pap.payorId) === String(account.id) ? pap.payee : pap.payor
                    return `**${pap.status}** — ${other.name} (${formatAccountNumber(other.number)})\n${pap.currency} ${formatCurrency(pap.weeklyLimit)} per week`
                }).join("\n\n")
                : "No PAPs found."
            return interaction.reply({ ...message("PAPs", description), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
        }

        const payor = await accountFromNumber(interaction.options.getString("from"))
        const payee = await accountFromNumber(interaction.options.getString("to"))
        if (action === "authorize") {
            const pap = await authorizePap(actor, payor, payee,
                interaction.options.getString("currency"), interaction.options.getNumber("weekly_limit"))
            return interaction.reply({ ...message("PAP authorized",
                `**${payee.name}** can collect from **${payor.name}** in ${pap.currency}.\n**Weekly limit:** ${formatCurrency(pap.weeklyLimit)}\nUse \`/account pap edit\` to change the limit or \`/account pap revoke\` to stop collections.`), flags: MessageFlags.Ephemeral })
        }
        if (action === "edit") {
            const pap = await editPap(actor, payor, payee, interaction.options.getNumber("weekly_limit"))
            return interaction.reply({ ...message("PAP updated", `**Weekly limit:** ${pap.currency} ${formatCurrency(pap.weeklyLimit)}`), flags: MessageFlags.Ephemeral })
        }
        if (action === "revoke") {
            await revokePap(actor, payor, payee)
            return interaction.reply({ ...message("PAP revoked", "No further collections can be made between these accounts."), flags: MessageFlags.Ephemeral })
        }
    } catch (error) {
        return interaction.reply(papError(error))
    }
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

            .addSubcommand(subcommand => subcommand
                .setName("access").setDescription("Set or remove a user's access to an account")
                .addStringOption(option => option.setName("account").setDescription("The account to manage").setRequired(true).setAutocomplete(true))
                .addUserOption(option => option.setName("user").setDescription("The user whose access will be set").setRequired(true))
                .addIntegerOption(option => option.setName("role").setDescription("The user's account role, or Remove to revoke access")
                    .setRequired(true).addChoices(
                        ...Object.entries(config.accountAccesses)
                            .filter(([name]) => name !== "Holder")
                            .map(([name, value]) => ({ name, value })),
                        { name: "Remove", value: REMOVE_ACCOUNT_ACCESS }
                    )))

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
                    .addStringOption(option => option
                        .setName("paying_account")
                        .setDescription("The number of the account that will pay")
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
                        .setDescription("Your account that blocked the requests")
                        .setRequired(true)
                        .setAutocomplete(true))
                    .addStringOption(option => option
                        .setName("requesting_account")
                        .setDescription("The account number to allow requests from")
                        .setRequired(true))))

            .addSubcommandGroup(group => group
                .setName("pap").setDescription("Manage pre authorised payments for your accounts")
                .addSubcommand(subcommand => subcommand
                    .setName("authorize").setDescription("Authorize a business to collect from your account")
                    .addStringOption(option => option.setName("from").setDescription("Your paying account").setRequired(true).setAutocomplete(true))
                    .addStringOption(option => option.setName("to").setDescription("The collecting business account number").setRequired(true))
                    .addStringOption(option => option.setName("currency").setDescription("Currency").setRequired(true).addChoices(config.currencies.map(value => ({ name: value, value }))))
                    .addNumberOption(option => option.setName("weekly_limit").setDescription("Maximum amount collectible each week").setRequired(true)))
                .addSubcommand(subcommand => subcommand
                    .setName("edit").setDescription("Change a PAP's weekly limit")
                    .addStringOption(option => option.setName("from").setDescription("The paying account").setRequired(true).setAutocomplete(true))
                    .addStringOption(option => option.setName("to").setDescription("The collecting business account number").setRequired(true))
                    .addNumberOption(option => option.setName("weekly_limit").setDescription("New maximum amount collectible each week").setRequired(true)))
                .addSubcommand(subcommand => subcommand
                    .setName("revoke").setDescription("Stop future collections between two accounts")
                    .addStringOption(option => option.setName("from").setDescription("The paying account").setRequired(true).setAutocomplete(true))
                    .addStringOption(option => option.setName("to").setDescription("The collecting business account number").setRequired(true)))
                .addSubcommand(subcommand => subcommand
                    .setName("list").setDescription("List PAPs for one of your accounts")
                    .addStringOption(option => option.setName("account").setDescription("Account to view").setRequired(true).setAutocomplete(true)))),

    cooldown: 0,
    scope: "global",

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()
        if (interaction.options.getSubcommandGroup(false) === "pap") return managePap(interaction, command)

        switch(command) {
            case "access":
                return manageAccountAccess(interaction)

            case "send": {
                const requester = await userFromDiscord(interaction.user.id)
                if (!requester) {
                    return interaction.reply({ ...message("Profile required", "Complete registration before sending payment requests.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }

                const [targetAccount, receivingAccount] = await Promise.all([
                    accountFromNumber(interaction.options.getString("paying_account")),
                    accountFromNumber(interaction.options.getString("account"))
                ])
                if (!targetAccount) {
                    return interaction.reply({ ...message("Account unavailable", "No paying account was found with that number.", "PAYMENT_REQUEST_TARGET_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                let result
                try {
                    result = await createPaymentRequest(
                        requester,
                        targetAccount,
                        receivingAccount,
                        interaction.options.getNumber("amount"),
                        interaction.options.getString("currency"),
                        interaction.options.getString("reference")
                    )
                } catch (error) {
                    if (error?.message === "PAYMENT_REQUEST_BLOCKED") {
                        return interaction.reply({ ...message("Request blocked", "This account cannot send payment requests to that paying account.", "PAYMENT_REQUEST_BLOCKED"), flags: MessageFlags.Ephemeral })
                    }
                    if (error?.message === "INVALID_AMOUNT" || error?.message === "INVALID_PAYMENT_REQUEST") {
                        return interaction.reply({ ...message("Invalid payment request", "Enter a positive amount with no more than two decimal places and a valid reference.", error.message), flags: MessageFlags.Ephemeral })
                    }
                    return interaction.reply({ ...message("Request not sent", "Check the account and make sure you have Signatory access, then try again.", "PAYMENT_REQUEST_FAILED"), flags: MessageFlags.Ephemeral })
                }
                const { request } = result

                const notification = {
                    ...message(
                        "Payment requested",
                        `**From:** ${result.receivingAccount.name} (${formatAccountNumber(result.receivingAccount.number)})\n**Paying account:** ${result.targetAccount.name} (${formatAccountNumber(result.targetAccount.number)})\n**Amount:** ${request.currency} ${formatCurrency(request.amount)}\n**Reference:** ${request.reference}\n\nAccept to pay from the named account. Blocking stops the requesting account from sending this account more requests.`,
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

                const signatories = await result.targetAccount.getUsers({
                    attributes: ["discordId"],
                    through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Signatory } } }
                })
                const deliveries = await Promise.allSettled(signatories
                    .filter(signatory => signatory.discordId)
                    .map(async signatory => (await interaction.client.users.fetch(signatory.discordId)).send(notification)))
                const messageIds = deliveries
                    .filter(delivery => delivery.status === "fulfilled")
                    .map(delivery => delivery.value.id)
                if (!messageIds.length) {
                    await request.update({ status: "CANCELLED" }).catch(console.error)
                    return interaction.reply({ ...message("Request not delivered", "No Signatory of the paying account could be sent a DM. No payment request remains active.", "PAYMENT_REQUEST_DM_FAILED"), flags: MessageFlags.Ephemeral })
                }
                await request.update({ messageIds })

                return interaction.reply({ ...message("Payment request sent", `Signatories of **${result.targetAccount.name}** were asked to pay **${request.currency} ${formatCurrency(request.amount)}** to **${result.receivingAccount.name}**.`, undefined, `Request #${request.id}`), flags: MessageFlags.Ephemeral })
            }

            case "unblock": {
                const actor = await userFromDiscord(interaction.user.id)
                const [blockedAccount, requestingAccount] = await Promise.all([
                    accountFromNumber(interaction.options.getString("account")),
                    accountFromNumber(interaction.options.getString("requesting_account"))
                ])
                if (!actor) {
                    return interaction.reply({ ...message("Profile required", "Complete registration before managing blocked requests.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
                }
                try {
                    await unblockPaymentRequests(actor, blockedAccount, requestingAccount)
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
                let staffMessage
                try {
                    const channel = await interaction.client.channels.fetch(config.requestChannelId || config.withdrawalChannelId)
                    if (!channel || typeof channel.send !== "function") throw new Error("REQUEST_CHANNEL_UNAVAILABLE")

                    const label = type === "DEPOSIT" ? "Deposit" : "Withdrawal"
                    const requestType = type === "DEPOSIT" ? "D" : "W"
                    const amountInMinorUnits = Math.round(amount * 100)
                    const encodedCurrency = Buffer.from(currency, "utf8").toString("base64url")
                    const requestData = `${requestType}_${account.id}_${interaction.user.id}_${amountInMinorUnits}_${encodedCurrency}`
                    const notification = message(`${label} requested`, `**Customer:** <@${interaction.user.id}>\n**Account:** ${account.name} (${formatAccountNumber(account.number)})\n**Amount:** ${currency} ${formatCurrency(amount)}\n**Status:** Pending`)
                    notification.allowedMentions = { parse: [] }
                    notification.components = [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`cashrequest_${requestData}_complete`).setLabel("Complete").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`cashrequest_${requestData}_decline`).setLabel("Decline").setStyle(ButtonStyle.Danger)
                    )]
                    staffMessage = await channel.send(notification)
                } catch (error) {
                    console.error(`Failed to submit ${type.toLowerCase()} request:`, error)
                    if (staffMessage) await staffMessage.delete().catch(console.error)
                    return interaction.editReply(message("Request not submitted", "The staff request could not be delivered. No money was moved.", "ACCOUNT_REQUEST_FAILED"))
                }

                const label = type === "DEPOSIT" ? "Deposit" : "Withdrawal"
                return interaction.editReply(message(`${label} requested`, `Your request for **${currency} ${formatCurrency(amount)}** involving **${account.name}** was sent to staff. This request does not move money by itself.`))
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
                const papGroup = interaction.options.getSubcommandGroup(false) === "pap"

                const cashRequest = command === "deposit" || command === "withdraw"
                const managesAccess = command === "access"
                const requiredAccess = managesAccess
                    ? config.accountAccesses.Manager
                    : papGroup && focused.name === "from" ? config.accountAccesses.Holder
                    : focused.name === "from" || cashRequest || (requestGroup && ["send", "unblock"].includes(command))
                    ? config.accountAccesses.Signatory
                    : config.accountAccesses.Viewer
                const statusFilter = managesAccess
                    ? { status: { [Op.ne]: "CLOSED" } }
                    : focused.name === "from" || cashRequest || (requestGroup && ["send", "unblock"].includes(command))
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
