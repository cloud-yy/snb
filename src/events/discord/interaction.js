import { DiscordjsErrorCodes, MessageFlags, Events, RESTJSONErrorCodes } from "discord.js"

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

            const errorMessage = { content: "There was an error executing this interaction!", flags: MessageFlags.Ephemeral }
        
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage)
            } else {
                await interaction.reply(errorMessage)
            }
        }
    }
}
