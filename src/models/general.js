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

export const account = (sequelize) => {
    return sequelize.define(
        "account",
        {
            id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            status: {
                type: DataTypes.TEXT,
                allowNull: false
            },

            type: {
                type: DataTypes.TEXT,
                allowNull: false
            },

            name: {
                type: DataTypes.TEXT,
                allowNull: false
            },

            number: {
                type: DataTypes.TEXT,
                unique: true,
                allowNull: false
            }
        }, {
            indexes: [
                { unique: true, fields: ["number"] },
                { unique: false, fields: ["name"] }
            ]
        }
    )
}

export const accountAccess = (sequelize) => {
    return sequelize.define(
        "accountAccess",
        {
            id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            accountId: {
                type: DataTypes.BIGINT,
                allowNull: false
            },

            userId: {
                type: DataTypes.BIGINT,
                allowNull: false
            },

            access: {
                type: DataTypes.TEXT,
                allowNull: false
            }
        }, {
            indexes: [
                { unique: true, fields: ["userId", "accountId"] },
                { fields: ["accountId"] }
            ]
        }
    )
}

export const accountBalance = (sequelize) => {
    return sequelize.define(
        "accountBalance",
        {
            id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            accountId: {
                type: DataTypes.BIGINT,
                allowNull: false
            },

            balance: {
                type: DataTypes.BIGINT,
                allowNull: false,
                defaultValue: 0
            },

            currency: {
                type: DataTypes.STRING,
                allowNull: false
            }
        }, {
            indexes: [
                { unique: true, fields: ["accountId", "currency"] },
                { fields: ["accountId"] }
            ]
        }
    )
}