import fs from "fs"
import path from "path"
import { pathToFileURL } from "url"

const routesPath = path.join(process.cwd(), "src", "routes")
const files = fs
    .readdirSync(routesPath, {recursive: true})
    .filter((file) => file.endsWith(".js"))

export default async function (web) {
    for (const file of files) {
        const fullPath = path.join(routesPath, file)

        try {
            const routeModule = await import(pathToFileURL(fullPath).href)
            const route = routeModule.default

            web.use(route)
        } catch (err) {
            console.error(`Failed to load route: ${file}`)
            console.error(err)
        }
    }

    console.log("Routes loaded.")
}