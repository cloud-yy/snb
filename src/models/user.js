import { DataTypes } from "sequelize"

export default (sequelize) => {
    return sequelize.define(
        "user",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },

            discordId: {
                type: DataTypes.STRING,
                unique: true
            },

            robloxId: {
                type: DataTypes.STRING,
                unique: true
            },
            robloxName: {
                type: DataTypes.STRING
            },

        }, {
            indexes: [
                { unique: true, fields: ["discordId"] },
                { unique: true, fields: ["robloxId"] }
            ]
        }
    )
}