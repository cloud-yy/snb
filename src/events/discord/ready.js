import { Events } from "discord.js"
import { configureAuditLogNotifications } from "#functions/util/auditLogNotifications"
import { configureBusinessLogNotifications } from "#functions/util/businessLogNotifications"

export default {
    event: Events.ClientReady,
    once: true,

    async execute(client) {
        configureAuditLogNotifications(client)
        configureBusinessLogNotifications(client)
        console.log(`${client.user.tag} is Online.`)
    }
}
