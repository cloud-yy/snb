import { EmbedBuilder } from "discord.js"

export default function message(title, text) {
    return {
        embeds: [
            new EmbedBuilder()
                .setAuthor({
                    name: "State National Bank",
                    iconURL: "https://cdn.discordapp.com/emojis/1531035917123322009.webp"
                })
                .setTitle(title)
                .setDescription(text)
                .setColor("#1c126e")
                .setTimestamp()
        ]
    }
}
