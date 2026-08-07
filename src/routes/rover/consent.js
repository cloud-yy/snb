import { userFromDiscord } from "#functions/db"
import { Router } from "express"
import { client } from "#index"
import isValidSignature from "#functions/util/isValidSignature"

const GUILD_ID = process.env.DISCORD_GUILD_ID

const router = Router()

router.post("/rover/consent", async (req, res) => {
    if (!isValidSignature) {
        return res.sendStatus(401)
    }

    try {
        if (
            !req.body ||
            !req.body.discordId ||
            !req.body.robloxId
        ) {
            return
        }

        const user = await userFromDiscord(req.body.discordId, req.body)

        if (!user.discordId) {
            return
        }

        const guild = await client.guilds.cache.get(GUILD_ID)

        if (!guild) {
            return
        }

        const role = await guild.roles.cache.find(r => r.name === "Customer")

        if (!role) {
            return
        }

        const member = await guild.members.fetch(user.discordId)

        if (!member) {
            return
        }

        await member.roles.add(role)
    } catch (error) {
        console.error(error)
    }

    return res.sendStatus(200)
})

export default router