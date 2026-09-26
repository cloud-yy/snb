import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"
import { bankName, bannerImage, embed, bankEmoji } from "#functions/templates/templates"
import config from "#config" with { type: "json" }

const connectButton = new ButtonBuilder().setCustomId("login").setLabel("Connect Your Account").setStyle(ButtonStyle.Secondary)
if (bankEmoji) connectButton.setEmoji(bankEmoji)

export default {
  embeds: [
    embed(bankName)
    .addFields(
      {
        name: config.branding.tagline,
        value: `Here at ${bankName} our business is your business, and we work to provide a straightforward and convenient banking service.\n\nWe have developed systems that make it easy to access and manage your money. To get started with ${bankName}, see your options below.`,
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
    new ActionRowBuilder().addComponents(connectButton)
  ]
}
