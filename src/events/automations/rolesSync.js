import { User } from "#models/models"
import { Op } from "sequelize"
import { client } from "#index"

const GUILD_ID = process.env.GUILD_ID

async function giveRoleByName(member, roleName) {
    const role = await guild.roles.cache.find(role => role.name === roleName)

    if (!role) {
        return
    }

    if (!member.roles.cache.has(role.id)) {
        return
    }

    return await member.roles.add(role)
}

export default {
    cron: "*/1 * * * *",

    async execute() {
        const guild = await client.guilds.cache.get(GUILD_ID)

        if (!guild) {
            return
        }

        const users = await User.findAll({ where: { discordId: { [Op.not]: null }, robloxId: { [Op.not]: null }, role: { [Op.not]: null } } })

        if (!Object.length(users)) {
            return
        }

        await Promise.all(users.map(async (user) => {
            const member = await guild.members.cache.get(user.discordId)

            if (!member) {
                return
            }

            giveRoleByName(member, "✔️")
            giveRoleByName(member, user.role)
        }))
    }
}