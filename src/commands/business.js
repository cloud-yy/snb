import { ApplicationIntegrationType, ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, Pap, User } from "#models/models"
import { accountFromNumber, hasAccountAccess } from "#functions/db/account"
import { collectPap, createPapRequest, isBusinessAccount } from "#functions/db/pap"
import { userFromDiscord } from "#functions/db/user"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import notifyOutgoingPap from "#functions/util/notifyOutgoingPap"
import message from "#functions/templates/message"
import { setBusinessLogChannel } from "#functions/db/businessLog"
import { issueBusinessApiKey } from "#functions/db/businessApiKey"
import notifyPapRequest from "#functions/util/notifyPapRequest"

function failure(error) {
    const descriptions = {
        INVALID_AMOUNT: "Enter a positive amount with no more than two decimal places.",
        INVALID_PAP: "Check the paying account number, business account, currency, weekly limit, and purpose.",
        INVALID_COLLECTION: "Choose a valid paying account and enter a reference of up to 18 characters.",
        BUSINESS_ACCOUNT_REQUIRED: "The collecting account must be a business account.",
        BUSINESS_ACCESS_REQUIRED: "You need Signatory access to the collecting business account.",
        PAP_UNAVAILABLE: "No active PAP exists between those accounts.",
        PAP_EXISTS: "An active PAP already exists between those accounts.",
        PAP_REQUEST_PENDING: "A PAP request is already pending between those accounts.",
        PAP_WEEKLY_LIMIT_EXCEEDED: "The amount exceeds this PAP's remaining weekly limit.",
        INSUFFICIENT_FUNDS: "The paying account does not have enough funds.",
        ACCOUNT_FROZEN: "A frozen account cannot process this collection.",
        ACCOUNT_CLOSED: "A closed account cannot process this collection.",
        ACCOUNT_UNAVAILABLE: "One of the accounts is unavailable."
    }
    return message("PAP not completed", descriptions[error?.message] || "Please try again or contact support.", error?.message in descriptions ? error.message : "PAP_FAILED")
}

export default {
    command: new SlashCommandBuilder()
        .setName("business")
        .setDescription("Manage business services and pre authorised payments")
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .addSubcommandGroup(group => group
            .setName("pap").setDescription("Manage pre authorised payments")
        .addSubcommand(subcommand => subcommand
            .setName("collect").setDescription("Collect funds from an account with a PAP")
            .addStringOption(option => option.setName("business").setDescription("Your collecting business account").setRequired(true).setAutocomplete(true))
            .addStringOption(option => option.setName("account").setDescription("The paying account").setRequired(true).setAutocomplete(true))
            .addNumberOption(option => option.setName("amount").setDescription("Amount to collect").setRequired(true))
            .addStringOption(option => option.setName("reference").setDescription("Payment reference").setRequired(true).setMinLength(1).setMaxLength(18)))
        .addSubcommand(subcommand => subcommand
            .setName("request").setDescription("Ask a paying account's Holders to authorize a PAP")
            .addStringOption(option => option.setName("business").setDescription("Your collecting business account").setRequired(true).setAutocomplete(true))
            .addStringOption(option => option.setName("paying_account").setDescription("The paying account number").setRequired(true))
            .addStringOption(option => option.setName("currency").setDescription("Currency").setRequired(true).addChoices(config.currencies.map(value => ({ name: value, value }))))
            .addNumberOption(option => option.setName("weekly_limit").setDescription("Maximum amount collectible each week").setRequired(true))
            .addStringOption(option => option.setName("reference").setDescription("Purpose of the PAP").setRequired(true).setMinLength(1).setMaxLength(100))))
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
            .setName("api").setDescription("Issue a new API key for a business account")
            .addStringOption(option => option.setName("account").setDescription("The business account number").setRequired(true).setAutocomplete(true))),

    scope: "global",
    cooldown: 0,

    async execute(interaction) {
        const action = interaction.options.getSubcommand()
        const group = interaction.options.getSubcommandGroup(false)
        if (group === "log") return manageBusinessLog(interaction)
        const actor = await userFromDiscord(interaction.user.id)
        if (!actor) return interaction.reply({ ...message("Profile required", "Complete registration before managing business accounts.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })

        if (action === "api") {
            const account = await accountFromNumber(interaction.options.getString("account"))
            try {
                const apiKey = await issueBusinessApiKey(actor, account)
                const domain = config.domain.replace(/\/$/, "")
                return interaction.reply({
                    ...message(
                        "Business API key issued",
                        `A new key was issued for **${account.name}**. Any previous key for this account is now invalid.\n\n**API key**\n\`${apiKey}\`\n\n**Account endpoints**\n\`GET ${domain}/api/account/${account.number}/info\`\n\`GET ${domain}/api/account/${account.number}/balance\`\n\`GET ${domain}/api/account/${account.number}/transactions\`\n\n**Payment requests**\n\`POST ${domain}/api/account/${account.number}/payment-requests\`\n\`GET ${domain}/api/account/${account.number}/payment-requests/{requestId}\`\n\n**PAPs**\n\`POST ${domain}/api/account/${account.number}/paps/requests\`\n\`GET ${domain}/api/account/${account.number}/paps/requests/{requestId}\`\n\`GET ${domain}/api/account/${account.number}/paps/{accountNumber}\`\n\`POST ${domain}/api/account/${account.number}/paps/{accountNumber}/take\`\n\nSend the key as \`Authorization: Bearer <key>\`. This key will not be shown again.`
                    ),
                    flags: MessageFlags.Ephemeral
                })
            } catch (error) {
                const managerRequired = error?.message === "MANAGER_ACCESS_REQUIRED"
                return interaction.reply({
                    ...message(
                        managerRequired ? "Manager access required" : "Business account required",
                        managerRequired
                            ? "Choose a business account where you have Manager or Holder access."
                            : "Choose an active business account and try again.",
                        error?.message || "BUSINESS_API_KEY_FAILED"
                    ),
                    flags: MessageFlags.Ephemeral
                })
            }
        }

        try {
            if (action === "collect") {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral })
                const payee = await accountFromNumber(interaction.options.getString("business"))
                const result = await collectPap(actor,
                    interaction.options.getString("account"),
                    payee,
                    interaction.options.getNumber("amount"),
                    interaction.options.getString("reference"))
                void notifyIncomingPayment(interaction.client, result.payee, {
                    amount: result.ledger.amount, currency: result.ledger.currency, reference: result.ledger.reference, transactionId: result.ledger.uuid
                })
                void notifyOutgoingPap(interaction.client, result.payor, result.payee, result.ledger)
                return interaction.editReply(message("PAP collected",
                    `**Amount:** ${result.ledger.currency} ${formatCurrency(result.ledger.amount)}\n**From:** ${formatAccountNumber(result.payor.number)}\n**To:** ${formatAccountNumber(result.payee.number)}`,
                    undefined, `Transaction ID: ${result.ledger.uuid}`))
            }

            if (action === "request") {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral })
                const payee = await accountFromNumber(interaction.options.getString("business"))
                const payor = await accountFromNumber(interaction.options.getString("paying_account"))
                const result = await createPapRequest(actor, payor, payee,
                    interaction.options.getString("currency"),
                    interaction.options.getNumber("weekly_limit"),
                    interaction.options.getString("reference"))
                const delivered = await notifyPapRequest(interaction.client, result)
                if (!delivered) return interaction.editReply(message("PAP request not delivered", "No Holder of the paying account could be sent a DM. No PAP request remains active.", "PAP_REQUEST_NOT_DELIVERED"))
                return interaction.editReply(message("PAP request sent",
                    `Holders of **${result.payor.name}** were asked to authorize **${result.payee.name}** to collect up to **${result.request.currency} ${formatCurrency(result.request.weeklyLimit)} per week**.`,
                    undefined, `Request #${result.request.id}`))
            }
        } catch (error) {
            if (!(error?.message in {
                INVALID_AMOUNT: 1, INVALID_PAP: 1, INVALID_COLLECTION: 1,
                BUSINESS_ACCOUNT_REQUIRED: 1, BUSINESS_ACCESS_REQUIRED: 1, PAP_UNAVAILABLE: 1,
                PAP_EXISTS: 1, PAP_REQUEST_PENDING: 1, PAP_WEEKLY_LIMIT_EXCEEDED: 1, INSUFFICIENT_FUNDS: 1, ACCOUNT_FROZEN: 1,
                ACCOUNT_CLOSED: 1, ACCOUNT_UNAVAILABLE: 1
            })) console.error("PAP failed:", error)
            return interaction.deferred
                ? interaction.editReply(failure(error))
                : interaction.reply({ ...failure(error), flags: MessageFlags.Ephemeral })
        }
    },

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true)
        const action = interaction.options.getSubcommand()

        if (action === "collect" && focused.name === "account") {
            const businessNumber = interaction.options.getString("business")
            const business = await Account.findOne({
                attributes: ["id"],
                where: { number: businessNumber, status: "ACTIVE" },
                include: [{
                    model: User,
                    as: "users",
                    attributes: [],
                    required: true,
                    where: { discordId: interaction.user.id },
                    through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Signatory } } }
                }]
            })
            if (!business) return interaction.respond([])
            const paps = await Pap.findAll({
                attributes: ["id"],
                where: { payeeId: business.id, status: "ACTIVE" },
                include: [{
                    model: Account,
                    as: "payor",
                    attributes: ["name", "number", "type"],
                    where: { [Op.or]: [
                        { number: { [Op.like]: `%${focused.value}%` } },
                        { name: { [Op.like]: `%${focused.value}%` } }
                    ] }
                }],
                limit: 25
            })
            return interaction.respond(paps.map(item => ({
                name: `${item.payor.name} - ${item.payor.type} - (${formatAccountNumber(item.payor.number)})`,
                value: item.payor.number
            })))
        }

        if (!["account", "business"].includes(focused.name)) return
        const managementCommand = interaction.options.getSubcommandGroup(false) === "log"
            || action === "api"
        const collectingBusiness = ["collect", "request"].includes(action) && focused.name === "business"
        const accounts = await Account.findAll({
            attributes: ["id", "name", "number", "type"],
            where: {
                [Op.and]: [
                    { [Op.or]: [
                        { number: { [Op.like]: `%${focused.value}%` } },
                        { name: { [Op.like]: `%${focused.value}%` } }
                    ] },
                    ...(managementCommand || collectingBusiness ? [
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
                    : collectingBusiness ? config.accountAccesses.Signatory
                    : config.accountAccesses.Viewer } } }
            }], limit: 25
        })
        return interaction.respond(accounts.map(account => ({
            name: `${account.name} - ${account.type} - (${formatAccountNumber(account.number)})`,
            value: account.number
        })))
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
