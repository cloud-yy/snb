import { DataTypes } from "sequelize"

export const user = (sequelize) => {
    return sequelize.define(
        "user",
        {
            id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            status: {
                type: DataTypes.TEXT,
                defaultValue: "ACTIVE"
            },

            role: {
                type: DataTypes.TEXT,
                defaultValue: "Customer"
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

            roverTimestamp: {
                type: DataTypes.DATE
            }
        }, {
            indexes: [
                { unique: true, fields: ["discordId"] },
                { unique: true, fields: ["robloxId"] }
            ]
        }
    )
}