import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AccountAccess, BusinessLog, sequelize } from "#models/models"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"

const channelFields = {
    audits: "auditChannelId",
    transactions: "transactionChannelId"
}

export async function setBusinessLogChannel(actor, account, guildId, kind, channelId) {
    const field = channelFields[kind]
    if (!actor || !account || !guildId || !field || !channelId) {
        throw new Error("INVALID_BUSINESS_LOG")
    }

    return sequelize.transaction(async transaction => {
        const lockedAccount = await Account.findByPk(account.id, {
            attributes: ["id", "type", "status"],
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        if (!lockedAccount || lockedAccount.status === "CLOSED") {
            throw new Error("ACCOUNT_UNAVAILABLE")
        }
        if (config.accounts?.[lockedAccount.type]?.type !== "business") {
            throw new Error("BUSINESS_ACCOUNT_REQUIRED")
        }

        const access = await AccountAccess.findOne({
            attributes: ["access"],
            where: {
                userId: actor.id,
                accountId: lockedAccount.id,
                access: { [Op.gte]: config.accountAccesses.Manager }
            },
            transaction
        })
        if (!access) throw new Error("MANAGER_ACCESS_REQUIRED")

        const [settings] = await BusinessLog.findOrCreate({
            where: { accountId: lockedAccount.id, guildId },
            defaults: { [field]: channelId },
            transaction
        })
        const before = settings[field] || null
        if (before !== channelId) await settings.update({ [field]: channelId }, { transaction })

        const auditLog = await actor.createAuditLog({
            accountId: lockedAccount.id,
            action: "BUSINESS_LOG_CHANNEL_UPDATED",
            before: { kind, guildId, channelId: before },
            after: { kind, guildId, channelId }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })

        return settings
    })
}
