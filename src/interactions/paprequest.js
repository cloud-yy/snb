import { MessageFlags } from "discord.js"
import { User } from "#models/models"
import { respondToPapRequest } from "#functions/db/pap"
import message from "#functions/templates/message"

function unavailable(description = "This PAP request has already been handled or is unavailable.") {
    return { ...message("Request unavailable", description, "PAP_REQUEST_UNAVAILABLE"), flags: MessageFlags.Ephemeral }
}

export default {
    id: "paprequest",

    async execute(interaction) {
        if (!interaction.isButton()) return
        const match = /^paprequest_(\d+)_(accept|decline)$/.exec(interaction.customId)
        if (!match) return

        const actor = await User.findOne({ attributes: ["id", "discordId"], where: { discordId: interaction.user.id } })
        if (!actor) return interaction.reply(unavailable("A registered Holder must respond to this request."))

        let result
        try {
            result = await respondToPapRequest(actor, match[1], match[2] === "accept" ? "AUTHORIZED" : "DECLINED")
        } catch (error) {
            if (error?.message === "HOLDER_REQUIRED") {
                return interaction.reply({ ...message("Holder access required", "Only a Holder of the paying account can respond to this request.", "HOLDER_REQUIRED"), flags: MessageFlags.Ephemeral })
            }
            return interaction.reply(unavailable())
        }

        if (result.pap) {
            return interaction.update({
                ...message("PAP authorized", "The business can now collect from the paying account within its weekly limit."),
                components: []
            })
        }
        return interaction.update({
            ...message("PAP declined", "The business cannot collect money under this request."),
            components: []
        })
    }
}
