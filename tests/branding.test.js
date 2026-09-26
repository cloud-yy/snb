import assert from "node:assert/strict"
import { test } from "node:test"
import express from "express"
import config from "../src/config.json" with { type: "json" }
import rootRouter from "../src/routes/root.js"
import { embed } from "../src/functions/templates/templates.js"

test("Discord embeds use configured branding", () => {
    const data = embed("Test").toJSON()
    assert.equal(data.author.name, config.branding.name)
    assert.equal(data.author.icon_url, config.branding.logos.iconUrl)
    assert.equal(data.color, Number.parseInt(config.branding.primaryColor.slice(1), 16))
})

test("the public site and manifest use configured branding", async t => {
    const app = express()
    app.use(rootRouter)
    const server = await new Promise(resolve => {
        const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer))
    })
    t.after(() => new Promise(resolve => server.close(resolve)))
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    const [pageResponse, manifestResponse] = await Promise.all([
        fetch(`${baseUrl}/`),
        fetch(`${baseUrl}/site.webmanifest`)
    ])
    const [page, manifest] = await Promise.all([pageResponse.text(), manifestResponse.json()])

    assert.match(page, new RegExp(config.branding.name))
    assert.match(page, new RegExp(config.branding.primaryColor, "i"))
    assert.equal(manifest.name, config.branding.name)
    assert.equal(manifest.short_name, config.branding.abbreviation)
    assert.equal(manifest.background_color, config.branding.primaryColor)
})
