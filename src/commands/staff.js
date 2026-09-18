import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js"
import { Account } from "#models/models"
import companyInfo from "#functions/templates/companyInfo"
import config from "#config" with { type: 'json' }
import { Op } from "sequelize"
import formatAccountNumber from "#functions/util/formatAccountNumber"

export default {
    command: 
        new SlashCommandBuilder()
            .setName("staff")
            .setDescription("Staff commands reserved for employees of the company")
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("deposit")
                    .setDescription("Sends the selected embed in the selected channel")
                    .addStringOption((option) =>
                        option
                            .setName("reserve")
                            .setDescription("The account that holds the customers money")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("account")
                            .setDescription("The account recieving the deposit")
                            .setRequired(true)
                            .setAutocomplete(true)
                    )
                    .addIntegerOption((option) =>
                        option
                            .setName("amount")
                            .setDescription("The amount deposited")
                            .setRequired(true)
                    )
                    .addStringOption((option) =>
                        option
                            .setName("currency")
                            .setDescription("The currency of the deposit")
                            .setRequired(true)
                            .addChoices(config.currencies.map(currency => ({ name: currency, value: currency })))
                    )
                )

            .addSubcommand((subcommand) =>
                subcommand
                    .setName("embed")
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
    scope: "local",

    execute: async (interaction) => {
        const command = interaction.options.getSubcommand()

        switch(command) {
            case "embed": {
                const channel = interaction.options.getChannel("channel") || interaction.channel

                await channel.send(companyInfo)

                return interaction.reply({ content: `Message successfully sent in <#${channel.id}>`, flags: MessageFlags.Ephemeral })
            }

            case "deposit": {
                console.log(interaction.options.data)

                return interaction.reply({ content: `hello hello!`, flags: MessageFlags.Ephemeral })
            }
        }
    },

    autocomplete: async (interaction) => {
        const focused = interaction.options.getFocused(true)

		switch(focused.name) {
            case "account":
            case "reserve": {
                const accounts = await Account.findAll({
                    where: {[Op.or]: [
                        { number: { [Op.like]: `%${focused.value}%` } },
                        { name: { [Op.like]: `%${focused.value}%` } }
                    ]},

                    limit: 25
                })

		        await interaction.respond(accounts.map(account => ({ name: `${account.name} [${formatAccountNumber(account.number)}]`, value: account.number })))
            }
        }
    }
}