import config from "#config" with { type: "json" }
import { auditLogNotification } from "#functions/util/auditLogs"

let client

export function configureAuditLogNotifications(discordClient) {
    client = discordClient
}

export function queueAuditLogNotification(auditLog, transaction) {
    if (!client || !auditLog?.id) return

    const deliver = async () => {
        try {
            const [channel, payload] = await Promise.all([
                client.channels.fetch(config.auditChannelId),
                auditLogNotification(auditLog.id)
            ])

            if (!channel?.isTextBased() || !payload) {
                console.error(`Audit log channel ${config.auditChannelId} is unavailable or is not text based.`)
                return
            }

            await channel.send(payload)
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
