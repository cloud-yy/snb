import {
    ApplicationIntegrationType,
    InteractionContextType,
    SlashCommandBuilder
} from "discord.js"
import access from "../interactions/access.js"

export default {
    command:
        new SlashCommandBuilder()
            .setName("access")
            .setDescription("Open online banking")
            .setIntegrationTypes(
                ApplicationIntegrationType.GuildInstall,
                ApplicationIntegrationType.UserInstall
            )
            .setContexts(
                InteractionContextType.Guild,
                InteractionContextType.BotDM,
                InteractionContextType.PrivateChannel
            ),

    cooldown: 5,
    scope: "global",

    execute: async interaction => await access.open(interaction)
}
