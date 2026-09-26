import { ApplicationIntegrationType, ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, DirectDebit, User } from "#models/models"
import { accountFromNumber, getAccountAccess, hasAccountAccess, removeAccountAccess, setAccountAccess } from "#functions/db/account"
import { authorizeDirectDebit, collectDirectDebit, isBusinessAccount, revokeDirectDebit } from "#functions/db/directDebit"
import { userFromDiscord } from "#functions/db/user"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import notifyOutgoingDirectDebit from "#functions/util/notifyOutgoingDirectDebit"
import message from "#functions/templates/message"
import { setBusinessLogChannel } from "#functions/db/businessLog"

const REMOVE_ACCOUNT_ACCESS = 0

function failure(error) {
    const descriptions = {
        INVALID_AMOUNT: "Enter a positive amount with no more than two decimal places.",
        INVALID_MANDATE: "Check the accounts, currency, and limits. The weekly limit and any total limit must be at least the per-collection limit.",
        INVALID_COLLECTION: "Enter a valid mandate ID and a reference of up to 18 characters.",
        HOLDER_REQUIRED: "An account holder must authorize or revoke this direct debit.",
        BUSINESS_ACCOUNT_REQUIRED: "The collecting account must be a business account.",
        BUSINESS_ACCESS_REQUIRED: "You need Signatory access to the collecting business account.",
        MANDATE_UNAVAILABLE: "This direct debit mandate is unavailable or has been revoked.",
        MANDATE_LIMIT_EXCEEDED: "The amount exceeds the per-collection or remaining total limit.",
        MANDATE_WEEKLY_LIMIT_EXCEEDED: "The amount exceeds this mandate's remaining weekly limit.",
        INSUFFICIENT_FUNDS: "The paying account does not have enough funds.",
        ACCOUNT_FROZEN: "A frozen account cannot process this collection.",
        ACCOUNT_CLOSED: "A closed account cannot process this collection.",
        ACCOUNT_UNAVAILABLE: "One of the accounts is unavailable."
    }
    return message("Direct debit not completed", descriptions[error?.message] || "Please try again or contact support.", error?.message in descriptions ? error.message : "DIRECT_DEBIT_FAILED")
}

async function manageAccess(interaction) {
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

    if (!isBusinessAccount(selectedAccount)) {
        return interaction.reply({ ...message("Business account required", "Access can only be managed here for business accounts.", "BUSINESS_ACCOUNT_REQUIRED"), flags: MessageFlags.Ephemeral })
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

export default {
    command: new SlashCommandBuilder()
        .setName("business")
        .setDescription("Manage business account access and direct debits")
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addSubcommandGroup(group => group
            .setName("directdebit").setDescription("Manage authorized direct debits")
        .addSubcommand(subcommand => subcommand
            .setName("authorize").setDescription("Authorize a business account to collect from your account")
            .addStringOption(option => option.setName("from").setDescription("Your paying account").setRequired(true).setAutocomplete(true))
            .addStringOption(option => option.setName("to").setDescription("The business account number").setRequired(true))
            .addStringOption(option => option.setName("currency").setDescription("Currency").setRequired(true).addChoices(config.currencies.map(value => ({ name: value, value }))))
            .addNumberOption(option => option.setName("max_amount").setDescription("Maximum amount for each collection").setRequired(true))
            .addNumberOption(option => option.setName("weekly_limit").setDescription("Maximum amount collectible each week").setRequired(true))
            .addNumberOption(option => option.setName("total_limit").setDescription("Optional lifetime collection cap")))
        .addSubcommand(subcommand => subcommand
            .setName("collect").setDescription("Collect funds using an authorized mandate")
            .addStringOption(option => option.setName("mandate").setDescription("Mandate ID").setRequired(true))
            .addNumberOption(option => option.setName("amount").setDescription("Amount to collect").setRequired(true))
            .addStringOption(option => option.setName("reference").setDescription("Payment reference").setRequired(true).setMinLength(1).setMaxLength(18)))
        .addSubcommand(subcommand => subcommand
            .setName("revoke").setDescription("Stop future collections under a mandate")
            .addStringOption(option => option.setName("mandate").setDescription("Mandate ID").setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("list").setDescription("List mandates for one of your accounts")
            .addStringOption(option => option.setName("account").setDescription("Account to view").setRequired(true).setAutocomplete(true))))
        .addSubcommandGroup(group => group
            .setName("log").setDescription("Configure server channels for business account logs")
            .addSubcommand(subcommand => subcommand
                .setName("audits").setDescription("Set the channel for account audit logs")
                .addStringOption(option => option.setName("account").setDescription("The business account to log").setRequired(true).setAutocomplete(true))
                .addChannelOption(option => option.setName("channel").setDescription("The audit log channel").setRequired(true)
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
            .addSubcommand(subcommand => subcommand
                .setName("transactions").setDescription("Set the channel for incoming and outgoing transactions")
                .addStringOption(option => option.setName("account").setDescription("The business account to log").setRequired(true).setAutocomplete(true))
                .addChannelOption(option => option.setName("channel").setDescription("The transaction log channel").setRequired(true)
                    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))))
        .addSubcommand(subcommand => subcommand
            .setName("access").setDescription("Set or remove a user's access to a business account")
            .addStringOption(option => option.setName("account").setDescription("The business account to manage").setRequired(true).setAutocomplete(true))
            .addUserOption(option => option.setName("user").setDescription("The user whose access will be set").setRequired(true))
            .addIntegerOption(option => option.setName("role").setDescription("The user's account role, or Remove to revoke access")
                .setRequired(true).addChoices(
                    ...Object.entries(config.accountAccesses)
                        .filter(([name]) => name !== "Holder")
                        .map(([name, value]) => ({ name, value })),
                    { name: "Remove", value: REMOVE_ACCOUNT_ACCESS }
                ))),

    scope: "global",
    cooldown: 0,

    async execute(interaction) {
        const action = interaction.options.getSubcommand()
        const group = interaction.options.getSubcommandGroup(false)
        if (action === "access") return manageAccess(interaction)
        if (group === "log") return manageBusinessLog(interaction)
        const actor = await userFromDiscord(interaction.user.id)
        if (!actor) return interaction.reply({ ...message("Profile required", "Complete registration before managing business accounts.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })

        try {
            if (action === "authorize") {
                const payor = await accountFromNumber(interaction.options.getString("from"))
                const payee = await accountFromNumber(interaction.options.getString("to"))
                const mandate = await authorizeDirectDebit(actor, payor, payee,
                    interaction.options.getString("currency"),
                    interaction.options.getNumber("max_amount"),
                    interaction.options.getNumber("weekly_limit"),
                    interaction.options.getNumber("total_limit"))
                return interaction.reply({ ...message("Direct debit authorized",
                    `**${payee.name}** can collect from **${payor.name}** in ${mandate.currency}.\n**Per collection:** ${formatCurrency(mandate.maxAmount)}\n**Weekly limit:** ${formatCurrency(mandate.weeklyLimit)}\n**Total limit:** ${mandate.totalLimit == null ? "None" : formatCurrency(mandate.totalLimit)}\nUse \`/business directdebit revoke\` to stop future collections.`,
                    undefined, `Mandate #${mandate.id}`), flags: MessageFlags.Ephemeral })
            }

            if (action === "collect") {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral })
                const { ledger, mandate, payor, payee } = await collectDirectDebit(actor,
                    interaction.options.getString("mandate"),
                    interaction.options.getNumber("amount"),
                    interaction.options.getString("reference"))
                void notifyIncomingPayment(interaction.client, payee, {
                    amount: ledger.amount, currency: ledger.currency, reference: ledger.reference, transactionId: ledger.uuid
                })
                void notifyOutgoingDirectDebit(interaction.client, payor, payee, ledger)
                return interaction.editReply(message("Direct debit collected",
                    `**Amount:** ${ledger.currency} ${formatCurrency(ledger.amount)}\n**From:** ${formatAccountNumber(payor.number)}\n**To:** ${formatAccountNumber(payee.number)}`,
                    undefined, `Mandate #${mandate.id} | Transaction ID: ${ledger.uuid}`))
            }

            if (action === "revoke") {
                const mandate = await revokeDirectDebit(actor, interaction.options.getString("mandate"))
                return interaction.reply({ ...message("Direct debit revoked", "No further collections can be made under this mandate.", undefined, `Mandate #${mandate.id}`), flags: MessageFlags.Ephemeral })
            }

            if (action === "list") {
                const account = await accountFromNumber(interaction.options.getString("account"))
                if (!account || !await hasAccountAccess(actor, account, config.accountAccesses.Viewer)) {
                    throw new Error("ACCOUNT_UNAVAILABLE")
                }
                const mandates = await DirectDebit.findAll({
                    where: { [Op.or]: [{ payorId: account.id }, { payeeId: account.id }] },
                    include: [
                        { model: Account, as: "payor", attributes: ["name", "number"] },
                        { model: Account, as: "payee", attributes: ["name", "number"] }
                    ],
                    order: [["createdAt", "DESC"]], limit: 10
                })
                const description = mandates.length
                    ? mandates.map(mandate => {
                        const other = String(mandate.payorId) === String(account.id) ? mandate.payee : mandate.payor
                        return `**#${mandate.id} · ${mandate.status}** — ${other.name} (${formatAccountNumber(other.number)})\n${mandate.currency} ${formatCurrency(mandate.totalCollected)} collected${mandate.totalLimit == null ? "" : ` of ${formatCurrency(mandate.totalLimit)} total`}; ${formatCurrency(mandate.weeklyLimit)} per week; max ${formatCurrency(mandate.maxAmount)} each`
                    }).join("\n\n")
                    : "No direct debit mandates found."
                return interaction.reply({ ...message("Direct debit mandates", description), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
            }
        } catch (error) {
            if (!(error?.message in {
                INVALID_AMOUNT: 1, INVALID_MANDATE: 1, INVALID_COLLECTION: 1, HOLDER_REQUIRED: 1,
                BUSINESS_ACCOUNT_REQUIRED: 1, BUSINESS_ACCESS_REQUIRED: 1, MANDATE_UNAVAILABLE: 1,
                MANDATE_LIMIT_EXCEEDED: 1, MANDATE_WEEKLY_LIMIT_EXCEEDED: 1, INSUFFICIENT_FUNDS: 1, ACCOUNT_FROZEN: 1,
                ACCOUNT_CLOSED: 1, ACCOUNT_UNAVAILABLE: 1
            })) console.error("Direct debit failed:", error)
            return interaction.deferred
                ? interaction.editReply(failure(error))
                : interaction.reply({ ...failure(error), flags: MessageFlags.Ephemeral })
        }
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true)
        if (!["from", "account"].includes(focused.name)) return
        const managementCommand = interaction.options.getSubcommand() === "access"
            || interaction.options.getSubcommandGroup(false) === "log"
        const accounts = await Account.findAll({
            attributes: ["name", "number", "type"],
            where: {
                [Op.and]: [
                    { [Op.or]: [
                        { number: { [Op.like]: `%${focused.value}%` } },
                        { name: { [Op.like]: `%${focused.value}%` } }
                    ] },
                    ...(managementCommand ? [
                        { type: { [Op.in]: Object.entries(config.accounts)
                            .filter(([, account]) => account.type === "business")
                            .map(([name]) => name) } },
                        { status: { [Op.ne]: "CLOSED" } }
                    ] : [])
                ]
            },
            include: [{
                model: User, as: "users", attributes: [], required: true,
                where: { discordId: interaction.user.id },
                through: { attributes: [], where: { access: { [Op.gte]: managementCommand
                    ? config.accountAccesses.Manager
                    : focused.name === "from" ? config.accountAccesses.Holder : config.accountAccesses.Viewer } } }
            }], limit: 25
        })
        return interaction.respond(accounts.map(account => ({ name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`, value: account.number })))
    }
}

async function manageBusinessLog(interaction) {
    if (!interaction.guildId || !interaction.guild) {
        return interaction.reply({ ...message("Server required", "Business log channels must be configured from the server that contains the channel.", "SERVER_REQUIRED"), flags: MessageFlags.Ephemeral })
    }

    const actor = await userFromDiscord(interaction.user.id)
    const account = await accountFromNumber(interaction.options.getString("account"))
    const channel = interaction.options.getChannel("channel")
    const kind = interaction.options.getSubcommand()

    if (!actor) {
        return interaction.reply({ ...message("Profile required", "Complete registration before managing business logs.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
    }
    if (!account || !isBusinessAccount(account) || !await hasAccountAccess(actor, account, config.accountAccesses.Manager)) {
        return interaction.reply({ ...message("Manager access required", "Choose a business account where you have Manager or Holder access.", "MANAGER_ACCESS_REQUIRED"), flags: MessageFlags.Ephemeral })
    }
    if (!channel || channel.guildId !== interaction.guildId || !channel.isTextBased() || typeof channel.send !== "function") {
        return interaction.reply({ ...message("Channel unavailable", "Choose a text channel from this server.", "INVALID_LOG_CHANNEL"), flags: MessageFlags.Ephemeral })
    }

    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe()
    const permissions = channel.permissionsFor(botMember)
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
        return interaction.reply({ ...message("Channel permissions required", "Give the bot View Channel, Send Messages, and Embed Links permissions in that channel, then try again.", "LOG_CHANNEL_PERMISSIONS_REQUIRED"), flags: MessageFlags.Ephemeral })
    }

    try {
        await setBusinessLogChannel(actor, account, interaction.guildId, kind, channel.id)
    } catch (error) {
        console.error("Failed to configure business log channel:", error)
        return interaction.reply({ ...message("Log channel not updated", "The business log channel could not be saved. Please try again or contact support.", "BUSINESS_LOG_UPDATE_FAILED"), flags: MessageFlags.Ephemeral })
    }

    return interaction.reply({
        ...message("Business log channel updated", `${kind === "audits" ? "Audit" : "Incoming and outgoing transaction"} logs for **${account.name}** will be sent to ${channel}.`),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    })
}
