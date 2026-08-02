import { MessageFlags, SlashCommandBuilder } from "discord.js"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("ping")
            .setDescription("Ping command to test the bot"),

    cooldown: 5,

    execute: async (interaction) => {
        return interaction.reply({ content: "Pong!", flags: MessageFlags.Ephemeral })
    }
}