import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"

export default async function notifyPapRequest(client, { request, payor, payee }) {
    try {
        const holders = await payor.getUsers({
            attributes: ["discordId"],
            through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Holder } } }
        })
        const notification = {
            ...message(
                "PAP authorization requested",
                `**Business:** ${payee.name} (${formatAccountNumber(payee.number)})\n**Account:** ${payor.name} (${formatAccountNumber(payor.number)})\n**Currency:** ${request.currency}\n**Weekly limit:** ${request.currency} ${formatCurrency(request.weeklyLimit)}\n**Purpose:** ${request.reference}\n\nAuthorizing lets this business collect payments within this weekly limit. Use \`/account pap revoke\` to stop future collections.`,
                undefined,
                `Request #${request.id}`
            ),
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`paprequest_${request.id}_accept`).setLabel("Authorize").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`paprequest_${request.id}_decline`).setLabel("Decline").setStyle(ButtonStyle.Danger)
            )],
            allowedMentions: { parse: [] }
        }
        const deliveries = await Promise.allSettled(holders
            .filter(holder => holder.discordId)
            .map(async holder => (await client.users.fetch(holder.discordId)).send(notification)))
        const delivered = deliveries.filter(delivery => delivery.status === "fulfilled").length
        if (!delivered) await request.update({ status: "DELIVERY_FAILED" })
        return delivered
    } catch (error) {
        await request.update({ status: "DELIVERY_FAILED" })
        throw error
    }
}
