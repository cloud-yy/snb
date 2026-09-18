import { userFromDiscord } from "#functions/db/user"
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

        await userFromDiscord(req.body.discordId, req.body)
    } catch (error) {
        console.error(error)
    }

    return res.sendStatus(200)
})

export default router