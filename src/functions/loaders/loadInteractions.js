import { Collection } from "discord.js"
import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"

const interactionsPath = path.join(process.cwd(), "src", "interactions")

const files = fs
	.readdirSync(interactionsPath, { recursive: true })
	.filter((file) => file.endsWith(".js"))

export default async function (client) {
	for (const file of files) {
		const fullPath = path.join(interactionsPath, file);

		try {
			const interactionModule = await import(pathToFileURL(fullPath).href)
			const interaction = interactionModule.default

			client.interactions.set(interaction.id, interaction)
		} catch (err) {
			console.error(`Failed to load interaction: ${file}`)
			console.error(err)
		}
	}

    console.log("Interactions loaded.")
}