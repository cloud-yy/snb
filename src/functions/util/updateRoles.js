import { client } from "#index"

let Guild
let Roles

export async function giveRoleByName(member, roleName) {
    const role = await Roles.find(role => role.name === roleName)

    if (!role) {
        return console.log(`${roleName} not found.`)
    }

    if (member.roles.cache.has(role.id)) {
        return
    }

    return await member.roles.add(role)
}

export async function updateRoles(user) {
    if (!Guild) {
        Guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID)
    }

    if (!Roles) {
        Roles = await Guild.roles.fetch()
    }
    
    const member = await Guild.members.fetch(user.discordId)

    if (!member) {
        return console.log("Member not found.")
    }
    
    giveRoleByName(member, "✔️")
    giveRoleByName(member, user.role)
}