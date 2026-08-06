import { Collection } from "discord.js"
import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"

const commandsPath = path.join(process.cwd(), "src", "commands")

const files = fs
	.readdirSync(commandsPath, { recursive: true })
	.filter((file) => file.endsWith(".js"))

export default async function (client) {
	for (const file of files) {
		const fullPath = path.join(commandsPath, file);

		try {
			const commandModule = await import(pathToFileURL(fullPath).href)
			const command = commandModule.default

			client.commands.set(command.command.name, command)

            if (!client.cooldowns.has(command.name)) {
                client.cooldowns.set(command.name, new Collection)
            }
		} catch (err) {
			console.error(`Failed to load command: ${file}`)
			console.error(err)
		}
	}

    console.log("Commands loaded.")
}