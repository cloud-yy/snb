import { embed } from "#functions/templates/templates"

export default function message(title, text, code, footer) {
    const description = code
        ? `${text}\n\n**Support code:** \`${code}\``
        : text
    const messageEmbed = embed(title, description)

    if (footer) {
        messageEmbed.setFooter({ text: footer })
    }

    return {
        embeds: [messageEmbed]
    }
}
