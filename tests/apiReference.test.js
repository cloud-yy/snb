import assert from "node:assert/strict"
import { test } from "node:test"
import config from "../src/config.json" with { type: "json" }
import apiReference from "../src/functions/templates/apiReference.js"

test("the staff API reference reflects the configured domain and current endpoints", () => {
    const embeds = apiReference.embeds.map(item => item.toJSON())
    const content = JSON.stringify(embeds)
    const domain = config.domain.replace(/\/$/, "")

    assert.equal(embeds.length, 4)
    assert.match(content, new RegExp(`${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/api/account/\\{accountNumber\\}`))
    assert.match(content, /payment-requests/)
    assert.match(content, /paps\/requests/)
    assert.match(content, /paps\/\{accountNumber\}\/take/)
    assert.match(content, /targetAccountNumber/)
    assert.match(content, /payorAccountNumber/)
    for (const embed of embeds) {
        assert.ok((embed.description?.length || 0) <= 4096)
        assert.ok((embed.fields || []).every(field => field.value.length <= 1024))
    }
})
