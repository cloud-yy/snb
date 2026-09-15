import { accessRequest, robloxFromDiscord } from "#functions/util/rover"
import { User } from "#models/models"

export async function userFromDiscord (discordId, robloxData) {
    let user = await User.findOne({
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

    return user
}