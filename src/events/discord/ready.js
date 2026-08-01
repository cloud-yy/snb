import { Events } from "discord.js"

export default {
    event: Events.ClientReady,
    once: true,

    async execute(client) {
        console.log(`${client.user.tag} is Online.`)
    }
}