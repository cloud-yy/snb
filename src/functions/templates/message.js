import { EmbedBuilder } from "discord.js"

export default function message(title, text) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(title)
                .setDescription(text)
                .setColor("#1c126e")
                .setTimestamp()
        ]
    }
}
