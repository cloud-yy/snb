import { Collection, MessageFlags, Events, time } from "discord.js"

export default {
    event: Events.InteractionCreate,
    once: false,

    async execute(interaction) {
        if (!interaction.isChatInputCommand()) return

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

                    return interaction.reply({ content: `This command is on cooldown, you can use it again <t:${expirationTime}:R>`, flags: MessageFlags.Ephemeral })
                }
            }

            timestamps.set(userId, now)
            setTimeout(() => timestamps.delete(userId), cooldown)
        }
        
        try {
            await command.execute(interaction)
        } catch (error) {
            console.error(`Error executing ${interaction.commandName}:`, error)

            const errorMessage = { content: "There was an error executing this command!", flags: MessageFlags.Ephemeral };
        
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }
}