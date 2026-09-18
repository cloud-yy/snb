import { createAccount } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import { MessageFlags, SlashCommandBuilder } from "discord.js"

export default {
    id: "login",

    execute: async (interaction) => {
        await interaction.reply({ content: "Setting up your user profile now, please wait.", flags: MessageFlags.Ephemeral })

        const user = await userFromDiscord(interaction.user.id)

        if (!user) {
            return interaction.followUp({ content: "Additional verification needed, please check your DMs from Rover.", flags: MessageFlags.Ephemeral })
        }

        await createAccount(user)

        return interaction.followUp({ content: "Your user profile has been successfully created!", flags: MessageFlags.Ephemeral })
    }
}