import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} from "discord.js"
import config from "#config" with { type: "json" }
import { backButton, bannerImage, embed, selectOptions, snbEmoji } from "#functions/templates/templates"

const login = {
    embeds: [
        embed(
            "Online Banking",
            "Log on to securely access and manage your State National Bank accounts."
        ).setImage(bannerImage)
    ],
    components: [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("access_login")
                .setLabel("Log On")
                .setEmoji(snbEmoji)
                .setStyle(ButtonStyle.Primary)
        )
    ]
}

function accountPicker(accounts = []) {
    const options = selectOptions(
        accounts.map(account => ({
            label: account.name,
            value: account.number,
            description: `${account.type} account • ${account.number}`
        })),
        "No accounts available"
    )

    return {
        embeds: [
            embed(
                "Choose an Account",
                "Select the account you would like to access."
            )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("access_account")
                    .setPlaceholder("Select an account")
                    .setDisabled(accounts.length === 0)
                    .addOptions(options)
            )
        ]
    }
}

function accessName(access) {
    return Object.entries(config.accountAccesses).find(([, value]) => value === access)?.[0] || "Unknown"
}

function accountBackButton(account) {
    return backButton(`access_back_main_${account.number}`)
}

function accountHome(account, access = config.accountAccesses.Viewer) {
    return {
        embeds: [
            embed(
                account.name,
                `Account number: **${account.number}**\nAccount type: **${account.type}**\nYour role: **${accessName(access)}**\n\nChoose an option below.`
            )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`access_balance_${account.number}`)
                    .setLabel("View Balances")
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`access_transfer_${account.number}`)
                    .setLabel("Make a Transfer")
                    .setDisabled(access < config.accountAccesses.Signatory)
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`access_manage_${account.number}`)
                    .setLabel("Manage Access")
                    .setDisabled(access < config.accountAccesses.Manager)
                    .setStyle(ButtonStyle.Secondary)
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("access_back_accounts")
                    .setLabel("Change Account")
                    .setStyle(ButtonStyle.Secondary)
            )
        ]
    }
}

function balances(account, accountBalances = []) {
    const balanceText = accountBalances.length > 0
        ? accountBalances.map(balance => `**${balance.currency}** ${balance.balance}`).join("\n")
        : "This account does not currently hold any balances."

    return {
        embeds: [embed(`${account.name} Balances`, balanceText)],
        components: [
            new ActionRowBuilder().addComponents(accountBackButton(account))
        ]
    }
}

function transfer(account) {
    return {
        embeds: [
            embed(
                `Transfer from ${account.name}`,
                "Enter the receiving account, amount, currency, and an optional reference to prepare a transfer."
            )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                accountBackButton(account),
                new ButtonBuilder()
                    .setCustomId(`access_transfer_details_${account.number}`)
                    .setLabel("Enter Transfer Details")
                    .setStyle(ButtonStyle.Primary)
            )
        ]
    }
}

function transferModal(account) {
    return new ModalBuilder()
        .setCustomId(`access_transfer_submit_${account.number}`)
        .setTitle("Make a Transfer")
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("account")
                    .setLabel("Receiving account number")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("amount")
                    .setLabel("Amount")
                    .setPlaceholder("0.00")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("currency")
                    .setLabel("Currency")
                    .setPlaceholder(config.currencies.join(", "))
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("reference")
                    .setLabel("Reference")
                    .setMaxLength(18)
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            )
        )
}

function manageAccess(account, users = []) {
    const accessList = users.length > 0
        ? users.slice(0, 25).map(user => `**${String(user.name).slice(0, 80)}** — ${String(user.role).slice(0, 30)}`).join("\n")
        : "No users currently have access to this account."

    return {
        embeds: [
            embed(
                `Manage ${account.name}`,
                `Review the users who can access this account or set a user's access level.\n\n**Current Access**\n${accessList}`
            )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                accountBackButton(account),
                new ButtonBuilder()
                    .setCustomId(`access_set_user_${account.number}`)
                    .setLabel("Set User Access")
                    .setStyle(ButtonStyle.Primary)
            )
        ]
    }
}

function setUserAccess(account, selectedUser, selectedAccess) {
    const userSelect = new UserSelectMenuBuilder()
        .setCustomId(`access_user_${account.number}_${selectedAccess || 0}`)
        .setPlaceholder("Select a user")

    if (selectedUser) {
        userSelect.setDefaultUsers(selectedUser)
    }

    return {
        embeds: [
            embed(
                `Set Access for ${account.name}`,
                "Choose a Discord user and the account role they should receive."
            )
        ],
        components: [
            new ActionRowBuilder().addComponents(
                userSelect
            ),
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`access_role_${account.number}_${selectedUser || 0}`)
                    .setPlaceholder("Select an account role")
                    .addOptions(
                        Object.entries(config.accountAccesses).map(([name, value]) => ({
                            label: name,
                            value: String(value),
                            default: value === selectedAccess
                        }))
                    )
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`access_manage_${account.number}`)
                    .setLabel("Back")
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`access_save_user_${account.number}_${selectedUser || 0}_${selectedAccess || 0}`)
                    .setLabel("Save Access")
                    .setDisabled(!selectedUser || !selectedAccess)
                    .setStyle(ButtonStyle.Primary)
            )
        ]
    }
}

export {
    accountHome,
    accountPicker,
    balances,
    login,
    manageAccess,
    setUserAccess,
    transfer,
    transferModal
}

export default {
    accountHome,
    accountPicker,
    balances,
    login,
    manageAccess,
    setUserAccess,
    transfer,
    transferModal
}
