import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AuditLog, Ledger, User } from "#models/models"
import message from "#functions/templates/message"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"

const PAGE_SIZE = 5

const actionNames = {
    ACCOUNT_CREATED: "Account created",
    ACCOUNT_ACCESS_UPDATED: "Account access updated",
    ACCOUNT_ACCESS_REMOVED: "Account access removed",
    ACCOUNT_ACTIVE: "Account activated",
    ACCOUNT_FROZEN: "Account frozen",
    ACCOUNT_CLOSED: "Account closed",
    TRANSFER: "Transfer completed",
    DEPOSIT_COMPLETED: "Deposit completed",
    WITHDRAWAL_COMPLETED: "Withdrawal completed",
    WITHDRAWAL_CANCELLED: "Withdrawal cancelled",
    DEPOSIT_REQUEST_COMPLETED: "Deposit request completed",
    DEPOSIT_REQUEST_DECLINED: "Deposit request declined",
    WITHDRAWAL_REQUEST_COMPLETED: "Withdrawal request completed",
    WITHDRAWAL_REQUEST_DECLINED: "Withdrawal request declined",
    DIRECT_DEBIT_AUTHORIZED: "Direct debit authorized",
    DIRECT_DEBIT_COLLECTED: "Direct debit collected",
    DIRECT_DEBIT_REVOKED: "Direct debit revoked",
    BUSINESS_LOG_CHANNEL_UPDATED: "Business log channel updated",
    PAYMENT_REQUEST_SENT: "Payment request sent",
    PAYMENT_REQUEST_ACCEPTED: "Payment request accepted",
    PAYMENT_REQUEST_DENIED: "Payment request denied",
    PAYMENT_REQUEST_BLOCKED: "Payment requests blocked"
}

function accessName(access) {
    return Object.entries(config.accountAccesses)
        .find(([, value]) => value === Number(access))?.[0] || "Unknown"
}

function customerName(user) {
    if (!user) return "Unavailable"

    return [
        user.robloxName && `**${user.robloxName}**`,
        user.discordId && `<@${user.discordId}>`
    ].filter(Boolean).join(" ") || "Unavailable"
}

function auditDetails(log, targets, showActor, showAccount) {
    const details = [`**Date:** <t:${Math.floor(log.createdAt.getTime() / 1000)}:f>`]

    if (showActor) {
        details.push(`**Made by:** ${log.user?.discordId ? `<@${log.user.discordId}>` : "System"}`)
    }

    if (showAccount) {
        details.push(`**Account:** ${log.account?.name || "Unavailable"}${log.account?.number ? ` (${formatAccountNumber(log.account.number)})` : ""}`)
    }

    if (["ACCOUNT_ACCESS_UPDATED", "ACCOUNT_ACCESS_REMOVED"].includes(log.action)) {
        const targetId = log.after?.userId ?? log.before?.userId
        details.push(`**Customer:** ${customerName(targets.get(String(targetId)))}`)

        if (log.before?.access !== undefined) {
            details.push(`**Previous access:** ${accessName(log.before.access)}`)
        }

        if (log.after?.access !== undefined) {
            details.push(`**New access:** ${accessName(log.after.access)}`)
        } else {
            details.push("**New access:** Removed")
        }
    }

    if (["ACCOUNT_ACTIVE", "ACCOUNT_FROZEN", "ACCOUNT_CLOSED"].includes(log.action)) {
        details.push(`**Status:** ${log.before?.status || "Unknown"} → ${log.after?.status || "Unknown"}`)

        if (log.after?.reason) {
            details.push(`**Reason:** ${String(log.after.reason).slice(0, 500)}`)
        }
    }

    if (["TRANSFER", "DEPOSIT_COMPLETED", "WITHDRAWAL_COMPLETED", "DIRECT_DEBIT_COLLECTED", "PAYMENT_REQUEST_ACCEPTED"].includes(log.action)) {
        if (log.before?.balance !== undefined && log.after?.balance !== undefined) {
            details.push(`**Balance change:** ${formatCurrency(log.before.balance)} → ${formatCurrency(log.after.balance)}`)
        }

        if (log.ledger?.uuid) {
            details.push(`**Transaction ID:** \`${log.ledger.uuid}\``)
        }
    }

    if (log.action === "WITHDRAWAL_CANCELLED") {
        if (log.after?.requestId) details.push(`**Request:** #${log.after.requestId}`)
        details.push("**Status:** Cancelled")
    }

    if ([
        "DEPOSIT_REQUEST_COMPLETED", "DEPOSIT_REQUEST_DECLINED",
        "WITHDRAWAL_REQUEST_COMPLETED", "WITHDRAWAL_REQUEST_DECLINED"
    ].includes(log.action)) {
        const requestId = log.after?.requestId ?? log.before?.requestId
        if (requestId) details.push(`**Request:** #${requestId}`)
        if (log.after?.status) details.push(`**Status:** ${log.after.status}`)
    }

    if (log.action === "ACCOUNT_CREATED") {
        if (log.after?.type) details.push(`**Type:** ${log.after.type}`)
        if (log.after?.status) details.push(`**Status:** ${log.after.status}`)
    }

    if (log.action === "BUSINESS_LOG_CHANNEL_UPDATED") {
        details.push(`**Log:** ${log.after?.kind || "Unknown"}`)
        if (log.before?.channelId) details.push(`**Previous channel:** <#${log.before.channelId}>`)
        if (log.after?.channelId) details.push(`**New channel:** <#${log.after.channelId}>`)
    }

    if (["PAYMENT_REQUEST_SENT", "PAYMENT_REQUEST_DENIED", "PAYMENT_REQUEST_BLOCKED"].includes(log.action)) {
        const requestId = log.after?.requestId ?? log.before?.requestId
        if (requestId) details.push(`**Request:** #${requestId}`)
        if (log.after?.amount !== undefined) details.push(`**Amount:** ${log.after.currency} ${formatCurrency(log.after.amount)}`)
        if (log.after?.reference) details.push(`**Reference:** ${String(log.after.reference).slice(0, 100)}`)
        if (log.after?.status) details.push(`**Status:** ${log.after.status}`)
    }

    return details.join("\n").slice(0, 1024)
}

async function auditTargets(logs) {
    const targetIds = [...new Set(logs.flatMap(log => [log.before?.userId, log.after?.userId])
        .filter(id => id !== undefined && id !== null)
        .map(String))]
    const targetUsers = targetIds.length
        ? await User.findAll({
            attributes: ["id", "discordId", "robloxName"],
            where: { id: { [Op.in]: targetIds } }
        })
        : []

    return new Map(targetUsers.map(user => [String(user.id), user]))
}

export async function auditLogNotification(auditLogId) {
    const log = await AuditLog.findByPk(auditLogId, {
        attributes: ["id", "action", "before", "after", "accountId", "userId", "ledgerId", "createdAt"],
        include: [
            { model: Account, attributes: ["name", "number"] },
            { model: User, attributes: ["discordId", "robloxName"] },
            { model: Ledger, attributes: ["uuid"] }
        ]
    })

    if (!log) return null

    const targets = await auditTargets([log])
    const response = message(
        actionNames[log.action] || log.action.replaceAll("_", " ").toLowerCase(),
        "A new audit log entry was recorded."
    )

    response.allowedMentions = { parse: [] }
    response.embeds[0].addFields({
        name: "Details",
        value: auditDetails(log, targets, true, true)
    })

    return response
}

export async function auditLogPage({
    where,
    requestedPage,
    buttonBase,
    title,
    description,
    footer,
    showActor = true,
    showAccount = true
}) {
    const count = await AuditLog.count({ where })
    const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE))
    const page = Math.min(Math.max(requestedPage, 0), pageCount - 1)
    const logs = await AuditLog.findAll({
        attributes: ["id", "action", "before", "after", "accountId", "userId", "ledgerId", "createdAt"],
        where,
        include: [
            { model: Account, attributes: ["name", "number"] },
            { model: User, attributes: ["discordId", "robloxName"] },
            { model: Ledger, attributes: ["uuid"] }
        ],
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
    })
    const targets = await auditTargets(logs)
    const response = message(
        title,
        count ? description : "No audit log entries were found.",
        undefined,
        `${footer} | Page ${page + 1} of ${pageCount}`
    )

    response.allowedMentions = { parse: [] }

    for (const log of logs) {
        response.embeds[0].addFields({
            name: actionNames[log.action] || log.action.replaceAll("_", " ").toLowerCase(),
            value: auditDetails(log, targets, showActor, showAccount)
        })
    }

    if (pageCount > 1) {
        response.components = [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${buttonBase}_${Math.max(page - 1, 0)}`)
                .setLabel("Previous")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId(`${buttonBase}_${Math.min(page + 1, pageCount - 1)}`)
                .setLabel("Next")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === pageCount - 1)
        )]
    } else {
        response.components = []
    }

    return response
}
