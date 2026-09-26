import { Router } from "express"
import fs from "fs"
import path from "path"
import config from "#config" with { type: "json" }

const router = Router()

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character])
}

router.get("/", async (_request, response) => {
    const branding = config.branding
    const values = {
        BANK_NAME: branding.name,
        BANK_ABBREVIATION: branding.abbreviation,
        BANK_TAGLINE: branding.tagline,
        BANK_DESCRIPTION: branding.description,
        PRIMARY_COLOR: branding.primaryColor,
        SECONDARY_COLOR: branding.secondaryColor,
        ICON_URL: branding.logos.faviconUrl,
        APPLE_ICON_URL: branding.logos.appleTouchIconUrl,
        BANNER_URL: branding.logos.bannerUrl,
        DOMAIN: config.domain.replace(/\/$/, "")
    }
    let page = fs.readFileSync(path.join(process.cwd(), "public", "index.html"), "utf8")
    for (const [key, value] of Object.entries(values)) {
        page = page.replaceAll(`{{${key}}}`, escapeHtml(value))
    }
    return response.type("html").send(page)
})

router.get("/site.webmanifest", (_request, response) => {
    const branding = config.branding
    return response.type("application/manifest+json").send({
        name: branding.name,
        short_name: branding.abbreviation,
        start_url: "/",
        icons: [
            { src: branding.logos.webApp192Url, sizes: "192x192", type: "image/png" },
            { src: branding.logos.webApp512Url, sizes: "512x512", type: "image/png" }
        ],
        theme_color: branding.secondaryColor,
        background_color: branding.primaryColor,
        display: "standalone",
        orientation: "portrait-primary"
    })
})

export default router
