import { MessageFlags } from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { accountFromNumber, getAccountAccess, setAccountAccess, transfer as makeTransfer } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import { accountHome, accountPicker, balances, manageAccess, setUserAccess, transfer, transferModal } from "#functions/templates/access"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"

const ephemeral = MessageFlags.Ephemeral

function accessName(access) {
    return Object.entries(config.accountAccesses).find(([, value]) => value === access)?.[0] || "Unknown"
}

async function getAccounts(user) {
    return await user.getAccounts({
        attributes: ["id", "name", "number", "status", "type"],
        joinTableAttributes: ["access"],
        through: {
            where: { access: { [Op.gte]: config.accountAccesses.Viewer } }
        },
        order: [["name", "ASC"]]
    })
}

async function getSelectedAccount(user, number, minimumAccess = config.accountAccesses.Viewer) {
    const account = await accountFromNumber(number)
    const access = await getAccountAccess(user, account)

    if (!account || access === null || access < minimumAccess) {
        return null
    }

    return { account, access }
}

async function getManagedUsers(account) {
    const users = await account.getUsers({
        attributes: ["id", "discordId", "robloxName"],
        joinTableAttributes: ["access"],
        order: [["robloxName", "ASC"]]
    })

    return users.map(user => ({
        id: user.id,
        name: user.robloxName || user.discordId || `User ${user.id}`,
        role: accessName(user.accountAccess.access)
    }))
}

async function sendError(interaction, content) {
    if (interaction.deferred) {
        return await interaction.editReply({ content, embeds: [], components: [] })
    }

    if (interaction.replied) {
        return await interaction.followUp({ content, flags: ephemeral })
    }

    return await interaction.reply({ content, flags: ephemeral })
}

async function requireUser(interaction) {
    const user = await userFromDiscord(interaction.user.id)

    if (!user) {
        await sendError(interaction, "Additional verification is required. Please check your DMs from Rover.")
        return null
    }

    return user
}

async function showAccountPicker(interaction, reply = false) {
    if (reply) {
        await interaction.deferReply({ flags: ephemeral })
    } else {
        await interaction.deferUpdate()
    }

    const user = await requireUser(interaction)

    if (!user) {
        return
    }

    const accounts = await getAccounts(user)
    return await interaction.editReply(accountPicker(accounts))
}

async function showAccountHome(interaction, accountNumber) {
    await interaction.deferUpdate()

    const user = await requireUser(interaction)

    if (!user) {
        return
    }

    const selected = await getSelectedAccount(user, accountNumber)

    if (!selected) {
        return await sendError(interaction, "That account was not found or you no longer have access to it.")
    }

    return await interaction.editReply(accountHome(selected.account, selected.access))
}

async function showBalances(interaction, accountNumber) {
    await interaction.deferUpdate()

    const user = await requireUser(interaction)
    const selected = user && await getSelectedAccount(user, accountNumber)

    if (!selected) {
        return await sendError(interaction, "That account was not found or you do not have permission to view it.")
    }

    const accountBalances = await selected.account.getAccountBalances({
        attributes: ["balance", "currency"],
        order: [["currency", "ASC"]]
    })

    const formattedBalances = accountBalances.map(balance => ({
        currency: balance.currency,
        balance: formatCurrency(balance.balance)
    }))

    return await interaction.editReply(balances(selected.account, formattedBalances))
}

async function showTransfer(interaction, accountNumber) {
    await interaction.deferUpdate()

    const user = await requireUser(interaction)
    const selected = user && await getSelectedAccount(user, accountNumber, config.accountAccesses.Signatory)

    if (!selected) {
        return await sendError(interaction, "You do not have permission to transfer from that account.")
    }

    return await interaction.editReply(transfer(selected.account))
}

async function showManageAccess(interaction, accountNumber) {
    await interaction.deferUpdate()

    const actor = await requireUser(interaction)
    const selected = actor && await getSelectedAccount(actor, accountNumber, config.accountAccesses.Manager)

    if (!selected) {
        return await sendError(interaction, "You do not have permission to manage access for that account.")
    }

    const users = await getManagedUsers(selected.account)
    return await interaction.editReply(manageAccess(selected.account, users))
}

async function showSetUserAccess(interaction, accountNumber, selectedUser, selectedAccess) {
    await interaction.deferUpdate()

    const actor = await requireUser(interaction)
    const selected = actor && await getSelectedAccount(actor, accountNumber, config.accountAccesses.Manager)

    if (!selected) {
        return await sendError(interaction, "You do not have permission to manage access for that account.")
    }

    return await interaction.editReply(setUserAccess(selected.account, selectedUser, selectedAccess))
}

async function saveUserAccess(interaction, accountNumber, discordId, requestedAccess) {
    await interaction.deferUpdate()

    const actor = await requireUser(interaction)
    const selected = actor && await getSelectedAccount(actor, accountNumber, config.accountAccesses.Manager)

    if (!selected || !discordId || !Object.values(config.accountAccesses).includes(requestedAccess)) {
        return await sendError(interaction, "The account, user, or role selection is invalid.")
    }

    const target = await userFromDiscord(discordId)

    if (!target) {
        return await sendError(interaction, "That user must complete account verification before access can be granted.")
    }

    const targetAccess = await getAccountAccess(target, selected.account)
    const managesElevatedAccess = requestedAccess >= config.accountAccesses.Manager
        || targetAccess >= config.accountAccesses.Manager

    if (selected.access < config.accountAccesses.Holder && managesElevatedAccess) {
        return await sendError(interaction, "Only account holders can add or change Managers and Holders.")
    }

    await setAccountAccess(actor, target, selected.account, requestedAccess)
    const users = await getManagedUsers(selected.account)
    return await interaction.editReply(manageAccess(selected.account, users))
}

async function submitTransfer(interaction, accountNumber) {
    await interaction.deferReply({ flags: ephemeral })

    const user = await requireUser(interaction)
    const selected = user && await getSelectedAccount(user, accountNumber, config.accountAccesses.Signatory)

    if (!selected) {
        return await sendError(interaction, "You do not have permission to transfer from that account.")
    }

    const receivingNumber = interaction.fields.getTextInputValue("account").replace(/\s+/g, "")
    const rawAmount = Number(interaction.fields.getTextInputValue("amount").replace(/,/g, ""))
    const currency = interaction.fields.getTextInputValue("currency").trim()
    const reference = interaction.fields.getTextInputValue("reference").trim() || "Transfer"
    const receivingAccount = await accountFromNumber(receivingNumber)

    if (!receivingAccount) {
        return await interaction.editReply("The receiving account could not be found.")
    }

    if (!config.currencies.includes(currency)) {
        return await interaction.editReply(`Currency must be one of: ${config.currencies.join(", ")}.`)
    }

    try {
        const ledger = await makeTransfer(
            selected.account,
            receivingAccount,
            rawAmount,
            currency,
            reference,
            user
        )

        return await interaction.editReply(
            `Transfer complete.\n${currency} ${formatCurrency(ledger.amount)}\n${formatAccountNumber(selected.account.number)} > ${formatAccountNumber(receivingAccount.number)}\nTransaction ID: ${ledger.uuid}`
        )
    } catch (error) {
        const messages = {
            SAME_ACCOUNT: "The sending and receiving accounts must be different.",
            ACCOUNT_FROZEN: "One of the accounts is frozen.",
            INVALID_AMOUNT: "Enter a valid amount greater than zero.",
            INSUFFICIENT_FUNDS: "The account has insufficient funds for this transfer."
        }

        return await interaction.editReply(messages[error.message] || "The transfer failed and no funds were moved.")
    }
}

export default {
    id: "access",

    open: async interaction => await showAccountPicker(interaction, true),

    execute: async interaction => {
        const [prefix, action, ...parts] = interaction.customId.split("_")

        if (prefix !== "access" || parts.some(part => !part)) {
            return await sendError(interaction, "This account action is no longer available.")
        }

        switch (action) {
            case "login":
                if (parts.length === 0) {
                    return await showAccountPicker(interaction, true)
                }
                break

            case "account":
                if (parts.length === 0 && interaction.values?.[0]) {
                    return await showAccountHome(interaction, interaction.values[0])
                }
                break

            case "back":
                if (parts.length === 1 && parts[0] === "accounts") {
                    return await showAccountPicker(interaction)
                }
                if (parts.length === 2 && parts[0] === "main") {
                    return await showAccountHome(interaction, parts[1])
                }
                break

            case "balance":
                if (parts.length === 1) {
                    return await showBalances(interaction, parts[0])
                }
                break

            case "transfer":
                if (parts.length === 2 && parts[0] === "details") {
                    return await interaction.showModal(transferModal({ number: parts[1] }))
                }
                if (parts.length === 2 && parts[0] === "submit") {
                    return await submitTransfer(interaction, parts[1])
                }
                if (parts.length === 1) {
                    return await showTransfer(interaction, parts[0])
                }
                break

            case "manage":
                if (parts.length === 1) {
                    return await showManageAccess(interaction, parts[0])
                }
                break

            case "set":
                if (parts.length === 2 && parts[0] === "user") {
                    return await showSetUserAccess(interaction, parts[1])
                }
                break

            case "user":
                if (parts.length === 2 && interaction.values?.[0]) {
                    return await showSetUserAccess(interaction, parts[0], interaction.values[0], Number(parts[1]) || undefined)
                }
                break

            case "role":
                if (parts.length === 2 && interaction.values?.[0]) {
                    return await showSetUserAccess(interaction, parts[0], parts[1] === "0" ? undefined : parts[1], Number(interaction.values[0]))
                }
                break

            case "save":
                if (parts.length === 4 && parts[0] === "user") {
                    return await saveUserAccess(interaction, parts[1], parts[2] === "0" ? undefined : parts[2], Number(parts[3]))
                }
                break
        }

        return await sendError(interaction, "This account action is no longer available.")
    }
}
