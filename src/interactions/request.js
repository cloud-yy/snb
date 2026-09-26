import { MessageFlags } from "discord.js"
import { User } from "#models/models"
import { closePaymentRequest, payPaymentRequest } from "#functions/db/paymentRequest"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import message from "#functions/templates/message"

async function actorFromInteraction(interaction) {
    return User.findOne({ attributes: ["id", "discordId"], where: { discordId: interaction.user.id } })
}

async function notifyRequester(client, request, outcome) {
    try {
        const requester = await User.findByPk(request.requesterId, { attributes: ["discordId"] })
        if (!requester?.discordId) return
        const discordUser = await client.users.fetch(requester.discordId)
        const descriptions = {
            DENIED: "A Signatory denied your payment request.",
            BLOCKED: "A Signatory denied your payment request and blocked this account from sending more requests."
        }
        await discordUser.send(message(outcome === "BLOCKED" ? "Payment requests blocked" : "Payment request denied", descriptions[outcome], undefined, `Request #${request.id}`))
    } catch (error) {
        console.error(`Could not notify payment requester for request ${request.id}:`, error)
    }
}

function unavailable() {
    return { ...message("Request unavailable", "This payment request has already been handled or you cannot act for its paying account.", "PAYMENT_REQUEST_UNAVAILABLE"), flags: MessageFlags.Ephemeral }
}

export default {
    id: "request",

    async execute(interaction) {
        if (!interaction.isButton()) return
        const match = /^request_(\d+)_(accept|deny|block)$/.exec(interaction.customId)
        if (!match) return

        const actor = await actorFromInteraction(interaction)
        if (!actor) return interaction.reply(unavailable())

        if (match[2] !== "accept") {
            const outcome = match[2] === "block" ? "BLOCKED" : "DENIED"
            let request
            try {
                request = await closePaymentRequest(actor, match[1], interaction.message.id, outcome)
            } catch {
                return interaction.reply(unavailable())
            }
            await interaction.update({
                ...message(outcome === "BLOCKED" ? "Payment request blocked" : "Payment request denied", outcome === "BLOCKED" ? "The requesting account cannot send this account more payment requests." : "No payment was sent.", undefined, `Request #${request.id}`),
                components: []
            })
            void notifyRequester(interaction.client, request, outcome)
            return
        }

        await interaction.deferUpdate()
        let result
        try {
            result = await payPaymentRequest(actor, match[1], interaction.message.id)
        } catch (error) {
            return interaction.followUp({ ...message("Payment not completed", "The request is unavailable or the paying account could not complete the payment.", error?.message || "PAYMENT_REQUEST_FAILED"), flags: MessageFlags.Ephemeral })
        }

        await interaction.editReply({
            ...message("Payment request paid", `You paid **${result.ledger.currency} ${formatCurrency(result.ledger.amount)}** from **${result.payingAccount.name}**.`, undefined, `Transaction ID: ${result.ledger.uuid}`),
            components: []
        })
        void notifyIncomingPayment(interaction.client, result.receivingAccount, {
            amount: result.ledger.amount,
            currency: result.ledger.currency,
            reference: result.ledger.reference,
            transactionId: result.ledger.uuid
        })
        return interaction.followUp({
            ...message("Payment sent", `**Amount:** ${result.ledger.currency} ${formatCurrency(result.ledger.amount)}\n**From:** ${formatAccountNumber(result.payingAccount.number)}\n**To:** ${formatAccountNumber(result.receivingAccount.number)}`, undefined, `Transaction ID: ${result.ledger.uuid}`),
            flags: MessageFlags.Ephemeral
        })
    }
}
