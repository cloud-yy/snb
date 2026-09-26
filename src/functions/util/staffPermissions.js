import config from "#config" with { type: "json" }

export async function hasStaffCommandAccess(client, discordId, command) {
    const requiredRole = config.staffPermissions?.commands?.[command]
    const roleIds = config.staffPermissions?.roles
    const guildId = process.env.DISCORD_GUILD_ID

    if (
        !client || !discordId || !guildId
        || !["staff", "management"].includes(requiredRole)
        || !roleIds?.staff || !roleIds?.management
    ) {
        return false
    }

    try {
        const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId)
        const member = await guild.members.fetch({ user: discordId, force: true })

        return member.roles.cache.has(roleIds.management)
            || (requiredRole === "staff" && member.roles.cache.has(roleIds.staff))
    } catch (error) {
        if (error?.code !== 10007) {
            console.error("Failed to verify staff role in the main guild:", error)
        }

        return false
    }
}
