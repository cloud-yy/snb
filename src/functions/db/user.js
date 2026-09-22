import { accessRequest, robloxFromDiscord } from "#functions/util/rover"
import { updateRoles } from "#functions/util/updateRoles"
import { User } from "#models/models"
import { Op } from "sequelize"

export async function userFromDiscord (discordId, robloxData) {
    let user = await User.findOne({
        attributes: ["id", "discordId", "robloxId", "robloxName", "roverTimestamp", "role"],
        where: {
            discordId: discordId 
        }
    })

    if (!user) {
        user = await User.create({
            discordId: discordId
        })
    }

    if (
        !user.robloxId ||
        !user.roverTimestamp ||
        user.roverTimestamp.getTime() + (7 * 24 * 60 * 60 * 1000) < Date.now()
    ) {
        if (!robloxData) {
            robloxData = await robloxFromDiscord(discordId)
        }

        if (!robloxData || !robloxData.robloxId) {
            accessRequest(discordId)

            return null
        }

        const updates = {}

        if (robloxData.robloxId) {
            updates.robloxId = robloxData?.robloxId
            updates.roverTimestamp = new Date()
        }

        if (robloxData.cachedUsername) {
            updates.robloxName = robloxData?.cachedUsername
        }

        if (Object.keys(updates).length) {
            await user.update(updates)
        }
    }

    await updateRoles(user)

    return user
}

export async function userFromDiscordExternal (discordId) {
    let user = await User.findOne({
        attributes: ["id", "discordId", "robloxId", "robloxName", "role", "status"],
        where: {
            discordId: discordId,
            robloxId: { [Op.not]: null }
        }
    })

    if (user) {
        return user
    }

    return null
}
