import { MessageFlags, SlashCommandBuilder } from "discord.js"

export default {
    id: "connectRoblox",

    execute: async (interaction) => {
        interaction.reply({ content: "Yo!", flags: MessageFlags.Ephemeral })

        return
    }
}