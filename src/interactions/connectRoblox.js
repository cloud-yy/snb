import { userFromDiscord } from "#functions/db/user"
import { MessageFlags } from "discord.js"
import message from "#functions/templates/message"
import config from "#config" with { type: "json" }

export default {
    id: "login",

    execute: async (interaction) => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral })

        const user = await userFromDiscord(interaction.user.id)

        if (!user) {
            return await interaction.editReply(message("Verification required", "Please check your direct messages from Rover to finish connecting your account.", "VERIFICATION_REQUIRED"))
        }

        return await interaction.editReply(message("Profile connected", `Your Discord and Roblox accounts are now connected to your ${config.branding.name} profile.`))
    }
}
