import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"
import cron from "node-cron"

const eventsPath = path.join(process.cwd(), "src", "events")
const files = fs
    .readdirSync(eventsPath, {recursive: true})
    .filter((file) => file.endsWith(".js"))

export default async function (client) {
    for (const file of files) {
        const fullPath = path.join(eventsPath, file)

        try {
            const eventModule = await import(pathToFileURL(fullPath).href)
            const event = eventModule.default

            if (event.cron) {
                cron.schedule(event.cron, () => event.execute())
            } else {
                if (event.once) {
                    client.once(event.event, (...args) => event.execute(...args))
                } else {
                    client.on(event.event, (...args) => event.execute(...args))
                }
            }
            
        } catch (err) {
            console.error(`Failed to load event: ${file}`)
            console.error(err)
        }
    }

    console.log("Events loaded.")
}