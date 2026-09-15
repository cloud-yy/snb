import { User } from "#models/models"
import { Op } from "sequelize"
import { updateRoles } from "#functions/util/updateRoles"

export default {
    cron: "*/1 * * * *",

    async execute() {
        const users = await User.findAll({ where: { discordId: { [Op.not]: null }, robloxId: { [Op.not]: null }, role: { [Op.not]: null } } })

        if (!users.length) {
            return
        }

        await Promise.all(users.map(async (user) => updateRoles(user)))
    }
}