import { embed } from "#functions/templates/templates"

export default function message(title, text) {
    return {
        embeds: [
            embed(title, text).setTimestamp()
        ]
    }
}
