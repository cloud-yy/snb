import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import message from "#functions/templates/message"

export default async function notifyOutgoingPap(client, payor, payee, ledger) {
    try {
        const recipients = await payor.getUsers({
            attributes: ["discordId"],
            through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Viewer } } }
        })
        const notification = {
            ...message("PAP collected",
                `**Amount:** ${ledger.currency} ${formatCurrency(ledger.amount)}\n**From:** ${payor.name} (${formatAccountNumber(payor.number)})\n**Collected by:** ${payee.name} (${formatAccountNumber(payee.number)})\n**Reference:** ${ledger.reference}\nUse \`/account pap revoke\` with both account numbers to stop future collections.`,
                undefined, `Transaction ID: ${ledger.uuid}`),
            allowedMentions: { parse: [] }
        }
        const deliveries = await Promise.allSettled(recipients
            .filter(recipient => recipient.discordId)
            .map(async recipient => (await client.users.fetch(recipient.discordId)).send(notification)))
        const failed = deliveries.filter(result => result.status === "rejected").length
        if (failed) console.warn(`Unable to deliver ${failed} PAP notification(s).`)
    } catch (error) {
        console.error("Failed to notify paying account of PAP:", error)
    }
}
