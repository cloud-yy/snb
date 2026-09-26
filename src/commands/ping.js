import { MessageFlags, SlashCommandBuilder } from "discord.js"
import message from "#functions/templates/message"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("ping")
            .setDescription("Ping command to test the bot"),

    cooldown: 5,
    scope: "global",

    execute: async (interaction) => {
        return interaction.reply({ ...message("Service status", "State National Bank services are online."), flags: MessageFlags.Ephemeral })
    }
}
