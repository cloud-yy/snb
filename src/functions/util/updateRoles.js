import { client } from "#index"

const GUILD_ID = process.env.GUILD_ID

export async function giveRoleByName(member, roleName) {
    const role = await guild.roles.cache.find(role => role.name === roleName)

    if (!role) {
        return
    }

    if (!member.roles.cache.has(role.id)) {
        return
    }

    return await member.roles.add(role)
}

export async function updateRoles(user) {
    const guild = await client.guilds.cache.get(GUILD_ID)

    if (!guild) {
        return
    }
    
    const member = await guild.members.cache.get(user.discordId)

    if (!member) {
        return
    }
    
    giveRoleByName(member, "✔️")
    giveRoleByName(member, user.role)
}