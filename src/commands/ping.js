import { MessageFlags, SlashCommandBuilder } from "discord.js"
import message from "#functions/templates/message"
import config from "#config" with { type: "json" }

export default {
    command: 
        new SlashCommandBuilder()
            .setName("ping")
            .setDescription("Ping command to test the bot"),

    cooldown: 5,
    scope: "global",

    execute: async (interaction) => {
        return interaction.reply({ ...message("Service status", `${config.branding.name} services are online.`), flags: MessageFlags.Ephemeral })
    }
}
