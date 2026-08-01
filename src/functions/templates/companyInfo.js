import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, resolvePartialEmoji } from "discord.js";

export default {
  embeds: [
    new EmbedBuilder()
    .setTitle("State National Bank")
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
    .setImage("https://media.discordapp.net/attachments/1491214857058385942/1533218894649622538/snbBaner.png?ex=6a6fb0de&is=6a6e5f5e&hm=aac0846f131c304fd6ce8c27767cea98aa85d4e5a6568d8f982ce1cb26948ed5&=&format=webp&quality=lossless")
    .setColor("#1c126e")
  ],

  components: [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("login").setLabel("Connect Your Account").setStyle(ButtonStyle.Secondary).setEmoji(resolvePartialEmoji("<:SNB:1531035917123322009>")))
  ]
}