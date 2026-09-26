import { EmbedBuilder, resolvePartialEmoji } from "discord.js"
import config from "#config" with { type: "json" }

export const bankName = config.branding.name
export const bankAbbreviation = config.branding.abbreviation
export const bannerImage = config.branding.logos.bannerUrl
export const brandColor = config.branding.primaryColor
export const brandIcon = config.branding.logos.iconUrl
export const bankEmoji = resolvePartialEmoji(config.branding.logos.emoji)

export function embed(title, description) {
    const template = new EmbedBuilder()
        .setAuthor({
            name: bankName,
            iconURL: brandIcon
        })
        .setColor(brandColor)

    if (title) {
        template.setTitle(title)
    }

    if (description) {
        template.setDescription(description)
    }

    return template
}
