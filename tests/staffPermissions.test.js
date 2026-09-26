import assert from "node:assert/strict"
import { test } from "node:test"
import config from "../src/config.json" with { type: "json" }
import { hasStaffCommandAccess } from "../src/functions/util/staffPermissions.js"

const guildId = "main-guild-test"
process.env.DISCORD_GUILD_ID = guildId

function clientWithRoles(roles) {
    const guild = {
        members: {
            fetch: async options => {
                assert.equal(options.user, "123456789")
                assert.equal(options.force, true)
                return { roles: { cache: new Map(roles.map(role => [role, true])) } }
            }
        }
    }

    return {
        guilds: {
            cache: new Map([[guildId, guild]]),
            fetch: async () => { throw new Error("Unexpected guild lookup") }
        }
    }
}

test("staff can use staff commands but not management commands", async () => {
    const client = clientWithRoles([config.staffPermissions.roles.staff])

    assert.equal(await hasStaffCommandAccess(client, "123456789", "transactions"), true)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "logs"), true)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "withdraw"), true)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "status"), true)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "deposit"), true)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "embed"), false)
})

test("management can use both levels of staff commands", async () => {
    const client = clientWithRoles([config.staffPermissions.roles.management])

    assert.equal(await hasStaffCommandAccess(client, "123456789", "transactions"), true)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "status"), true)
})

test("a main guild member without either role is denied, including unconfigured commands", async () => {
    const client = clientWithRoles([])

    assert.equal(await hasStaffCommandAccess(client, "123456789", "transactions"), false)
    assert.equal(await hasStaffCommandAccess(client, "123456789", "unknown"), false)
})
