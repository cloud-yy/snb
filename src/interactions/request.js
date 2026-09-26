import {
    ActionRowBuilder, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} from "discord.js"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AccountBalance, PaymentRequest, User } from "#models/models"
import { closePaymentRequest, payPaymentRequest } from "#functions/db/paymentRequest"
import formatAccountNumber from "#functions/util/formatAccountNumber"
import formatCurrency from "#functions/util/formatCurrency"
import notifyIncomingPayment from "#functions/util/notifyIncomingPayment"
import message from "#functions/templates/message"

async function targetFromInteraction(interaction) {
    return User.findOne({ attributes: ["id", "discordId"], where: { discordId: interaction.user.id } })
}

async function notifyRequester(client, request, outcome) {
    try {
        const requester = await User.findByPk(request.requesterId, { attributes: ["discordId"] })
        if (!requester?.discordId) return
        const discordUser = await client.users.fetch(requester.discordId)
        const descriptions = {
            DENIED: "The customer denied your payment request.",
            BLOCKED: "The customer denied your payment request and blocked this account from sending more requests."
        }
        await discordUser.send(message(
            outcome === "BLOCKED" ? "Payment requests blocked" : "Payment request denied",
            descriptions[outcome],
            undefined,
            `Request #${request.id}`
        ))
    } catch (error) {
        console.error(`Could not notify payment requester for request ${request.id}:`, error)
    }
}

function unavailable() {
    return { ...message("Request unavailable", "This payment request has already been handled or is not yours.", "PAYMENT_REQUEST_UNAVAILABLE"), flags: MessageFlags.Ephemeral }
}

export default {
    id: "request",

    async execute(interaction) {
        const buttonMatch = /^request_(\d+)_(accept|deny|block)$/.exec(interaction.customId)
        const selectMatch = /^request_pay_(\d+)$/.exec(interaction.customId)
        if (!buttonMatch && !selectMatch) return

        const target = await targetFromInteraction(interaction)
        if (!target) return interaction.reply(unavailable())

        if (buttonMatch) {
            const request = await PaymentRequest.findByPk(buttonMatch[1], {
                attributes: ["id", "requesterId", "targetId", "receivingAccountId", "amount", "currency", "reference", "status", "messageId"]
            })
            if (!request || request.status !== "PENDING" || String(request.targetId) !== String(target.id)
                || request.messageId !== interaction.message.id) {
                return interaction.reply(unavailable())
            }

            if (buttonMatch[2] === "accept") {
                const accounts = await Account.findAll({
                    attributes: ["id", "name", "number", "type"],
                    where: { status: "ACTIVE", id: { [Op.ne]: request.receivingAccountId } },
                    include: [
                        {
                            model: User,
                            as: "users",
                            attributes: [],
                            required: true,
                            where: { id: target.id },
                            through: { attributes: [], where: { access: { [Op.gte]: config.accountAccesses.Signatory } } }
                        },
                        {
                            model: AccountBalance,
                            attributes: ["balance"],
                            required: true,
                            where: { currency: request.currency, balance: { [Op.gte]: request.amount } }
                        }
                    ],
                    limit: 25
                })
                if (!accounts.length) {
                    return interaction.reply({ ...message("No eligible account", `You do not have an active account with enough ${request.currency} and Signatory access to pay this request.`, "PAYMENT_ACCOUNT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
                }

                const select = new StringSelectMenuBuilder()
                    .setCustomId(`request_pay_${request.id}`)
                    .setPlaceholder("Choose an account to pay from")
                    .addOptions(accounts.map(account => new StringSelectMenuOptionBuilder()
                        .setLabel(account.name.slice(0, 100))
                        .setDescription(`${account.type} · ${formatAccountNumber(account.number)}`.slice(0, 100))
                        .setValue(String(account.id))))
                return interaction.reply({
                    ...message("Choose a paying account", `Select the account that will pay **${request.currency} ${formatCurrency(request.amount)}**.`),
                    components: [new ActionRowBuilder().addComponents(select)],
                    flags: MessageFlags.Ephemeral
                })
            }

            const outcome = buttonMatch[2] === "block" ? "BLOCKED" : "DENIED"
            let closed
            try {
                closed = await closePaymentRequest(target, request.id, interaction.message.id, outcome)
            } catch (error) {
                return interaction.reply(unavailable())
            }
            void notifyRequester(interaction.client, closed, outcome)
            return interaction.update({
                ...message(
                    outcome === "BLOCKED" ? "Payment requests blocked" : "Payment request denied",
                    outcome === "BLOCKED"
                        ? "This request was denied. The requesting account cannot send you more payment requests."
                        : "This request was denied. No money was moved.",
                    undefined,
                    `Request #${closed.id}`
                ),
                components: []
            })
        }

        if (!interaction.isStringSelectMenu()) return
        const request = await PaymentRequest.findByPk(selectMatch[1], {
            attributes: ["id", "targetId", "status", "messageId"]
        })
        if (!request || request.status !== "PENDING" || String(request.targetId) !== String(target.id)) {
            return interaction.reply(unavailable())
        }

        await interaction.deferUpdate()
        let result
        try {
            result = await payPaymentRequest(target, request.id, request.messageId, interaction.values[0])
        } catch (error) {
            const descriptions = {
                INSUFFICIENT_FUNDS: "That account no longer has enough funds.",
                ACCOUNT_FROZEN: "One of the accounts is frozen.",
                ACCOUNT_CLOSED: "One of the accounts is closed.",
                SAME_ACCOUNT: "The paying and receiving accounts must be different.",
                SIGNATORY_ACCESS_REQUIRED: "You no longer have permission to pay from that account.",
                PAYMENT_REQUEST_UNAVAILABLE: "This payment request has already been handled."
            }
            return interaction.editReply({
                ...message("Payment not completed", descriptions[error?.message] || "The payment could not be completed. Choose Accept on the original request to try again.", error?.message || "PAYMENT_REQUEST_FAILED"),
                components: []
            })
        }

        try {
            const original = await interaction.channel.messages.fetch(result.request.messageId)
            await original.edit({
                ...message("Payment request paid", `You paid **${result.ledger.currency} ${formatCurrency(result.ledger.amount)}** from **${result.payingAccount.name}**.`, undefined, `Transaction ID: ${result.ledger.uuid}`),
                components: []
            })
        } catch (error) {
            console.error(`Could not update payment request ${result.request.id} message:`, error)
        }

        void notifyIncomingPayment(interaction.client, result.receivingAccount, {
            amount: result.ledger.amount,
            currency: result.ledger.currency,
            reference: result.ledger.reference,
            transactionId: result.ledger.uuid
        })
        return interaction.editReply({
            ...message("Payment sent", `**Amount:** ${result.ledger.currency} ${formatCurrency(result.ledger.amount)}\n**From:** ${formatAccountNumber(result.payingAccount.number)}\n**To:** ${formatAccountNumber(result.receivingAccount.number)}`, undefined, `Transaction ID: ${result.ledger.uuid}`),
            components: []
        })
    }
}
