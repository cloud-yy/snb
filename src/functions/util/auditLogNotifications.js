import config from "#config" with { type: "json" }
import { auditLogNotification } from "#functions/util/auditLogs"
import { BusinessLog } from "#models/models"
import { Op } from "sequelize"

let client

export function configureAuditLogNotifications(discordClient) {
    client = discordClient
}

export function queueAuditLogNotification(auditLog, transaction, { central = false } = {}) {
    if (!client || !auditLog?.id) return

    const deliver = async () => {
        try {
            const businessSettings = auditLog.accountId
                ? await BusinessLog.findAll({
                    attributes: ["auditChannelId"],
                    where: {
                        accountId: auditLog.accountId,
                        auditChannelId: { [Op.ne]: null }
                    }
                })
                : []
            if (!central && businessSettings.length === 0) return

            const payload = await auditLogNotification(auditLog.id)
            if (!payload) return
            const deliveries = await Promise.allSettled([
                ...(central ? [(async () => {
                    const channel = await client.channels.fetch(config.auditChannelId)
                    if (!channel?.isTextBased() || typeof channel.send !== "function") {
                        throw new Error(`Audit log channel ${config.auditChannelId} is unavailable or is not text based.`)
                    }
                    return channel.send(payload)
                })()] : []),
                ...businessSettings.map(async settings => {
                    const channel = await client.channels.fetch(settings.auditChannelId)
                    if (!channel?.isTextBased() || typeof channel.send !== "function") {
                        throw new Error(`Business audit log channel ${settings.auditChannelId} is unavailable or is not text based.`)
                    }
                    return channel.send(payload)
                })
            ])
            const failed = deliveries.filter(result => result.status === "rejected").length
            if (failed) console.warn(`Unable to deliver ${failed} audit log notification(s).`)
        } catch (error) {
            console.error("Failed to post audit log notification:", error)
        }
    }

    if (transaction?.afterCommit) {
        transaction.afterCommit(() => { void deliver() })
    } else {
        void deliver()
    }
}
