import config from "#config" with { type: "json" }
import message from "#functions/templates/message"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import { Op } from "sequelize"

export default async function notifyIncomingPayment(client, account, payment) {
    try {
        const recipients = await account.getUsers({
            attributes: ["discordId"],
            through: {
                attributes: [],
                where: {
                    access: {
                        [Op.gte]: config.accountAccesses.Viewer
                    }
                }
            }
        })
        const details = [
            `**Amount:** ${payment.currency} ${formatCurrency(payment.amount)}`,
            `**Account:** ${account.name} (${formatAccountNumber(account.number)})`,
            payment.reference && `**Reference:** ${payment.reference}`
        ].filter(Boolean).join("\n")
        const notification = {
            ...message("Money received", details, undefined, `Transaction ID: ${payment.transactionId}`),
            allowedMentions: { parse: [] }
        }
        const deliveries = await Promise.allSettled(
            recipients
                .filter(recipient => recipient.discordId)
                .map(async recipient => {
                    const discordUser = await client.users.fetch(recipient.discordId)
                    return await discordUser.send(notification)
                })
        )
        const failedDeliveries = deliveries.filter(result => result.status === "rejected").length

        if (failedDeliveries) {
            console.warn(`Unable to deliver ${failedDeliveries} incoming payment notification(s).`)
        }
    } catch (error) {
        console.error("Failed to send incoming payment notifications:", error)
    }
}
