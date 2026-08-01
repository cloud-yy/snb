import companyInfo from "#functions/templates/companyInfo"
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("staff")
            .setDescription("Staff commands reserved for employees of the company")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("embed")
                    .setDescription("Sends the selected embed in the selected channel")
                    .addStringOption((option) =>
                        option
                            .setName("embed")
                            .setDescription("The name of the embed you want to send.")
                            .setRequired(true)
                            .addChoices(
                                { name: "companyInfo", value: "companyInfo" },
                                { name: "register", value: "register" },
                                { name: "openAccount", value: "openAccount" },
                                { name: "accountOptions", value: "accountOptions" }
                            )
                    )
                    .addChannelOption((option) =>
                        option
                            .setName('channel')
                            .setDescription('The channel to echo into')
                            .addChannelTypes(ChannelType.GuildText)
                    )
        ),

    cooldown: 0,

    execute: async (interaction) => {
        const channel = interaction.options.getChannel("channel")

        channel.send({ embeds: [companyInfo] })

        return interaction.reply({ content: `Message successfully sent in <#${channel.id}>`, flags: MessageFlags.Ephemeral })
    }
}