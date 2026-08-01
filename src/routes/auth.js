import { User } from '#models/models'
import axios from 'axios'
import { Router } from 'express'
import * as crypto from 'crypto';

const router = Router()

const CLIENT_ID = process.env.ROBLOX_CLIENT_ID
const CLIENT_SECRET = process.env.ROBLOX_CLIENT_SECRET
const REDIRECT_URI = process.env.ROBLOX_REDIRECT_URI

const AUTH_URL = "https://apis.roblox.com/oauth/v1/authorize"
const TOKEN_URL = "https://apis.roblox.com/oauth/v1/token"
const USERINFO_URL = "https://apis.roblox.com/oauth/v1/userinfo"

const ERROR_MESSAGE = "OAuth error: we were unable to log you in, please try again and if error persists contact staff."
const CLOSE_TAB =
`<script>
    window.close();
</script>`

const authStates = new Map()

function randomString(len = 32) {
    return crypto.randomBytes(len).toString("hex")
}

router.get("/auth/roblox",(req, res) => {
    try {
        const state = randomString(16)

        authStates.set(state, {
            discordId: req.query.discordId,
            createdAt: Date.now()
        })

        const params = new URLSearchParams({
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: "openid profile",
            state
        })

        res.redirect(`${AUTH_URL}?${params.toString()}`)
    } catch (error) {
        console.error(error)
        return res.status(500).send(ERROR_MESSAGE)
    }
})

router.get("/auth/roblox/callback", async (req, res) => {
    try {
        const { code, state, error, error_description } = req.query

        if (error) {
            console.error(`OAuth error: ${error} ${error_description || ""}`)
            return res.status(400).send(ERROR_MESSAGE)
        }

        if (!code || !state || !authStates.has(state)) {
            return res.status(400).send(ERROR_MESSAGE)
        }

        const ctx = authStates.get(state)
        authStates.delete(state)

        const tokenBody = new URLSearchParams({
            grant_type: "authorization_code",
            code: String(code),
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri: REDIRECT_URI
        })

        let tokenData

        try {
            const { data } = await axios({
                method: "post",
                url: TOKEN_URL,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                data: tokenBody
            })

            tokenData = data
        } catch(error) {
            console.error(error)
            return res.status(400).send(ERROR_MESSAGE)
        }

        const accessToken = tokenData.access_token

        if (!accessToken) {
            return res.status(400).send(ERROR_MESSAGE)
        }

        let robloxUser

        try {
            const { data } = await axios({
                method: "get",
                url: USERINFO_URL,
                headers: { Authorization: `Bearer ${accessToken}` }
            })

            robloxUser = data
        } catch(error) {
            console.error(error)
            return res.status(400).send(ERROR_MESSAGE)
        }

        const robloxId = robloxUser.sub
        const robloxName = robloxUser.preferred_username || rbUser.name || null

        if (ctx?.discordId) {
            const user = await User.findOne({ where: { discordId: ctx.discordId } })

            if (user) {
                user.robloxId = String(robloxId)
                if (robloxName) user.robloxName = robloxName
                await user.save()
            }
        }

        return res.send(`Roblox account linked successfully! ${CLOSE_TAB}`)
    } catch (error) {
        console.error(error)
        return res.status(500).send(ERROR_MESSAGE)
    }
})

export default router