import { userFromDiscord } from "#functions/db/user"
import { MessageFlags } from "discord.js"

export default {
    id: "login",

    execute: async (interaction) => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        const user = await userFromDiscord(interaction.user.id)

        if (!user) {
            return await interaction.editReply("Additional verification needed, please check your DMs from Rover.")
        }

        return await interaction.editReply("Your user profile has been successfully created!")
    }
}
