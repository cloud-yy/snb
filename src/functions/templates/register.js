import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"
import { bannerImage, embed, snbEmoji } from "#functions/templates/templates"

export default {
  embeds: [
    embed("State National Bank")
    .addFields(
      {
        name: "Our Business is Your Business",
        value: "Here at State National Bank our business is your business, we have been working tirelessly to provide you the most straight forward and convenient banking service.\n\nWe have developed systems to make it as easy as possible to access and manage your money no matter the game or the rules. To get started with State National Bank see your options below, we are excited to start working with you!",
        inline: false
      },
      {
        name: "Getting Started",
        value: "To start your finacial journey with us you will need to first register your Roblox and Discord account with us. To do this please **click the button below.** From there your next options will become avaliable.",
        inline: false
      },
      {
        name: "Support",
        value: "Should there be any issues with your sign up do not hesitate to contact our staff team.",
        inline: false
      },
    )
    .setImage(bannerImage)
  ],

  components: [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("login").setLabel("Connect Your Account").setStyle(ButtonStyle.Secondary).setEmoji(snbEmoji))
  ]
}
