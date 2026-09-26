import { Events } from "discord.js"
import { configureAuditLogNotifications } from "#functions/util/auditLogNotifications"

export default {
    event: Events.ClientReady,
    once: true,

    async execute(client) {
        configureAuditLogNotifications(client)
        console.log(`${client.user.tag} is Online.`)
    }
}
