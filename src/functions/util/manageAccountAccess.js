import { MessageFlags } from "discord.js"
import config from "#config" with { type: "json" }
import { accountFromNumber, getAccountAccess, removeAccountAccess, setAccountAccess } from "#functions/db/account"
import { userFromDiscord } from "#functions/db/user"
import message from "#functions/templates/message"

export const REMOVE_ACCOUNT_ACCESS = 0

export default async function manageAccountAccess(interaction) {
    const account = await accountFromNumber(interaction.options.getString("account"))
    const discordUser = interaction.options.getUser("user")
    const requestedAccess = interaction.options.getInteger("role")
    const removeAccess = requestedAccess === REMOVE_ACCOUNT_ACCESS
    const roleName = Object.entries(config.accountAccesses).find(([, access]) => access === requestedAccess)?.[0]
    const actor = await userFromDiscord(interaction.user.id)

    if (!removeAccess && !roleName) {
        return interaction.reply({ ...message("Role not recognised", "Choose one of the available account roles and try again.", "INVALID_ACCOUNT_ROLE"), flags: MessageFlags.Ephemeral })
    }
    if (!actor) {
        return interaction.reply({ ...message("Profile required", "Complete registration before managing account access.", "PROFILE_NOT_FOUND"), flags: MessageFlags.Ephemeral })
    }

    const actorAccess = await getAccountAccess(actor, account)
    if (!account || actorAccess === null || actorAccess < config.accountAccesses.Manager) {
        return interaction.reply({ ...message("Manager access required", "Choose an account where you have Manager or Holder access.", "ACCOUNT_MANAGEMENT_UNAVAILABLE"), flags: MessageFlags.Ephemeral })
    }
    if (account.status === "CLOSED") {
        return interaction.reply({ ...message("Account closed", "Access roles can no longer be changed for this account.", "ACCOUNT_CLOSED"), flags: MessageFlags.Ephemeral })
    }

    const target = await userFromDiscord(discordUser.id)
    if (!target) {
        return interaction.reply({ ...message("Customer not found", "The selected user does not have a customer profile yet.", "CUSTOMER_NOT_FOUND"), flags: MessageFlags.Ephemeral })
    }

    const targetAccess = await getAccountAccess(target, account)
    if (requestedAccess === config.accountAccesses.Holder || targetAccess === config.accountAccesses.Holder) {
        return interaction.reply({ ...message("Holder access protected", "Holder access cannot be added, changed, or removed with this command.", "HOLDER_ACCESS_RESTRICTED"), flags: MessageFlags.Ephemeral })
    }
    if (removeAccess && targetAccess !== null && targetAccess >= actorAccess) {
        return interaction.reply({ ...message("Removal not permitted", "You can only remove customers with a lower access level than your own.", "ACCESS_LEVEL_RESTRICTED"), flags: MessageFlags.Ephemeral })
    }

    const managesElevatedAccess = requestedAccess >= config.accountAccesses.Manager || targetAccess >= config.accountAccesses.Manager
    if (actorAccess < config.accountAccesses.Holder && managesElevatedAccess) {
        return interaction.reply({ ...message("Holder approval required", "Only an account holder can add, change, or remove Manager access.", "HOLDER_APPROVAL_REQUIRED"), flags: MessageFlags.Ephemeral })
    }

    if (removeAccess) {
        try {
            await removeAccountAccess(actor, target, account)
        } catch (error) {
            const errors = {
                ACCOUNT_ACCESS_NOT_FOUND: ["No access found", "This customer does not currently have access to the account."],
                LAST_ACCOUNT_HOLDER: ["Holder required", "The account's last Holder cannot be removed. Add another Holder first."],
                ACCOUNT_CLOSED: ["Account closed", "Access roles can no longer be changed for this account."]
            }
            const response = errors[error?.message]
            if (response) return interaction.reply({ ...message(response[0], response[1], error.message), flags: MessageFlags.Ephemeral })
            console.error("Failed to remove account access:", error)
            return interaction.reply({ ...message("Access not removed", "The account access could not be removed.", "ACCESS_REMOVE_FAILED"), flags: MessageFlags.Ephemeral })
        }
        return interaction.reply({ ...message("Access removed", `${discordUser} no longer has access to **${account.name}**.`), flags: MessageFlags.Ephemeral })
    }

    try {
        await setAccountAccess(actor, target, account, requestedAccess)
    } catch (error) {
        const errors = {
            ACCOUNT_ACCESS_NOT_ALLOWED: ["Role unavailable", `**${account.type}** accounts do not support the **${roleName}** role.`],
            ACCOUNT_ACCESS_LIMIT_REACHED: ["Access limit reached", `This account already has the configured maximum number of customers with the **${roleName}** role.`],
            ACCOUNT_CLOSED: ["Account closed", "Access roles can no longer be changed for this account."]
        }
        const response = errors[error?.message]
        if (response) return interaction.reply({ ...message(response[0], response[1], error.message), flags: MessageFlags.Ephemeral })
        console.error("Failed to update account access:", error)
        return interaction.reply({ ...message("Access not updated", "The account access could not be updated.", "ACCESS_UPDATE_FAILED"), flags: MessageFlags.Ephemeral })
    }

    return interaction.reply({ ...message("Access updated", `${discordUser} now has the **${roleName}** role for **${account.name}**.`), flags: MessageFlags.Ephemeral })
}
