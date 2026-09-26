import { Collection, MessageFlags, Events, time } from "discord.js"
import message from "#functions/templates/message"

export default {
    event: Events.InteractionCreate,
    once: false,

    async execute(interaction) {
        if (interaction.isChatInputCommand()) {

            const command = interaction.client.commands.get(interaction.commandName)
            if (!command) return

            if (command.cooldown) {
                const cooldowns = interaction.client.cooldowns

                const now = Date.now()
                const timestamps = cooldowns.get(command.name)
                const cooldown = (command.cooldown) * 1000
                const userId = interaction.user.id

                if (timestamps.has(userId)) {
                    const expiration = timestamps.get(userId) + cooldown

                    if (now < expiration) {
                        const expirationTime = Math.round(expiration / 1000)

                        return interaction.reply({ ...message("Please wait", `You can use this command again <t:${expirationTime}:R>.`, "COMMAND_COOLDOWN"), flags: MessageFlags.Ephemeral })
                    }
                }

                timestamps.set(userId, now)
                setTimeout(() => timestamps.delete(userId), cooldown)
            }
            
            try {
                await command.execute(interaction)
            } catch (error) {
                console.error(`Error executing ${interaction.commandName}:`, error)

                const errorMessage = { ...message("Command not completed", "Something went wrong while processing your request. Please try again or contact support.", "COMMAND_FAILED"), flags: MessageFlags.Ephemeral }
            
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage)
                } else {
                    await interaction.reply(errorMessage)
                }
            }
        } else if (interaction.isAutocomplete()) {
            const command = interaction.client.commands.get(interaction.commandName)

            if (!command) return

            try {
                await command.autocomplete(interaction)
            } catch (error) {
                console.error(`Error autocompleting ${interaction.commandName}:`, error)
            }
        }
    } 
}
