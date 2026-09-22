import { Client, Events, GatewayIntentBits, Partials, Collection, ActivityType, PresenceUpdateStatus } from "discord.js"
import express from "express"
import path from "path"

import loadEvents from "#functions/loaders/loadEvents"
import loadCommands from "#functions/loaders/loadCommands"
import loadRoutes from "#functions/loaders/loadRoutes"
import { sequelize } from "#models/models"
import loadInteractions from "#functions/loaders/loadInteractions"

const { Guilds, GuildMembers, GuildMessages, MessageContent, DirectMessages, GuildPresences } = GatewayIntentBits
const { User, Message, GuildMember, ThreadMember } = Partials

const web = express()
web.use(express.json())
web.use(express.static(path.join(process.cwd(), 'public')))

const client = new Client({
	intents: [Guilds, GuildMembers, GuildMessages, MessageContent, DirectMessages, GuildPresences],
	partials: [User, Message, GuildMember, ThreadMember],
})

client.commands = new Collection()
client.interactions = new Collection()
client.cooldowns = new Collection()

client.setMaxListeners(0)
client.options.presence = { activities: [{ name: "Operational" }], status: PresenceUpdateStatus.Online }

let ready = false

Promise.all([loadRoutes(web), loadEvents(client, ready), loadCommands(client), loadInteractions(client)]).then(() => {
	console.log("Database connecting.")
	sequelize.authenticate().then(() => {
		console.log("Database connected.")

		sequelize.sync({ alter: process.env.POSTGRES_ALTER, force: process.env.POSTGRES_FORCE }).then(() => {
			console.log("Database synced.")

			console.log("Logging in.")
			client.login(process.env.DISCORD_BOT_TOKEN).then(() => {
				console.log("Logged in.")

				console.log("Webserver starting.")
				web.listen(8081)
				console.log("Webserver started.")
				ready = true
				console.log("Ready!")
			})
		})
	})
})

export { client, web }
