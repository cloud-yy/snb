import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import { REST, Routes } from "discord.js"

const files = fs.readdirSync(path.join(process.cwd(), "src", "commands"), { recursive: true }).filter((file) => file.endsWith(".js"))

const globalCommands = []
const guildCommands = []

const loadCommands = async () => {
    for (const file of files) {
        const fullPath = path.join(path.join(process.cwd(), "src", "commands"), file)

        const commandModule = await import(pathToFileURL(fullPath).href)
        const command = commandModule.default || commandModule

        const commandData = command.command.toJSON()

        if (command.scope === "local") {
            guildCommands.push(commandData)
        } else {
            globalCommands.push(commandData)
        }
    }
};

const rest = new REST().setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
    try {
        await loadCommands()

        console.log(`Started refreshing application (/) commands...`)

        if (guildCommands.length > 0) {
            const guildRoute = Routes.applicationGuildCommands(process.env.DISCORD_APPLICATION_ID, process.env.DISCORD_GUILD_ID)
            const guildData = await rest.put(guildRoute, { body: guildCommands })
            console.log(`Successfully registered ${guildData.length} local guild commands.`)
        } else {
            console.log("No local guild commands found to register.")
        }

        if (globalCommands.length > 0) {
            const globalRoute = Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID)
            const globalData = await rest.put(globalRoute, { body: globalCommands })
            console.log(`Successfully registered ${globalData.length} global commands.`)
        } else {
            console.log("No global commands found to register.")
        }

        process.exit(0)
    } catch (error) {
        console.error("Error deploying commands:", error)

        process.exit(1)
    }
})()
