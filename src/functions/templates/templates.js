import { EmbedBuilder, resolvePartialEmoji } from "discord.js"

export const bannerImage = "https://media.discordapp.net/attachments/1491214857058385942/1533218894649622538/snbBaner.png?ex=6ab2ed5e&is=6ab19bde&hm=97779001539b4653b269bacb439b85b7794c3f5f1cfea4a79149712315c68cf6&=&format=webp&quality=lossless"
export const brandColor = "#1c126e"
export const brandIcon = "https://cdn.discordapp.com/emojis/1531035917123322009.webp"
export const snbEmoji = resolvePartialEmoji("<:SNB:1531035917123322009>")

export function embed(title, description) {
    const template = new EmbedBuilder()
        .setAuthor({
            name: "State National Bank",
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