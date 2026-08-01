import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { REST, Routes } from "discord.js";

const files = fs.readdirSync(path.join(process.cwd(), "src", "commands"), { recursive: true }).filter((file) => file.endsWith(".js"))
const commands = []

const loadCommands = async () => {
	for (const file of files) {
		const fullPath = path.join(path.join(process.cwd(), "src", "commands"), file);

		const commandModule = await import(pathToFileURL(fullPath).href);
		const command = commandModule.default || commandModule;

		commands.push(command.command.toJSON())
	}
};

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    await loadCommands()

    const route = Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID)
    const data = (await rest.put(route, {
        body: commands
    }))

    console.log(`Successfully registered ${data.length} global commands.`);
})()