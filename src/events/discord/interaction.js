import { DiscordjsErrorCodes, MessageFlags, Events, RESTJSONErrorCodes } from "discord.js"
import message from "#functions/templates/message"

export default {
    event: Events.InteractionCreate,
    once: false,

    async execute(interaction) {
        if (!interaction.customId) return

        const interactionType = interaction.customId.split("_")[0]
        const interactionModule = interaction.client.interactions.get(interactionType)
        if (!interactionModule) return
        
        try {
            await interactionModule.execute(interaction)
        } catch (error) {
            console.error(`Error executing ${interaction.customId}:`, error)

            if (
                error.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged ||
                error.code === DiscordjsErrorCodes.InteractionAlreadyReplied
            ) {
                return
            }

            const errorMessage = { ...message("Request not completed", "Something went wrong while processing your request. Please try again or contact support.", "INTERACTION_FAILED"), flags: MessageFlags.Ephemeral }
        
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage)
            } else {
                await interaction.reply(errorMessage)
            }
        }
    }
}
