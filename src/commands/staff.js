import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Account } from "#models/models"
import companyInfo from "#functions/templates/companyInfo"
import config from "#config"
import { Op } from "sequelize"

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
                            .setName("Reserve")
                            .setDescription("The account that holds the customers money")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("Account")
                            .setDescription("The account recieving the deposit")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addIntegerOption((option) =>
                        option
                            .setName("Amount")
                            .setDescription("The amount deposited")
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("Currency")
                            .setDescription("The currency of the deposit")
                            .setRequired(true)
                            .addChoices(config.currencies.map(currency => ({ name: currency, value: currency })))
                    )
                )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("deposit")
                    .setDescription("Registers a deposit and debits relevant accounts")
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
            ),

    cooldown: 0,

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()

        switch(command) {
            case "embed": {
                const channel = interaction.options.getChannel("channel") || interaction.channel

                await channel.send(companyInfo)

                return interaction.reply({ content: `Message successfully sent in <#${channel.id}>`, flags: MessageFlags.Ephemeral })
            }

            case "deposit": {
                
            }
        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		const accounts = await Account.findAll({
            where: { accountNumber: { [Op.like]: `%${searchString}%`} }
        })

		await interaction.respond(accounts.map(account => ({ name: account.accountNumber, value: account.accountNumber })));
    }
}