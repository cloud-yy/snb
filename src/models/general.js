import { DataTypes } from "sequelize"

export const user = (sequelize) => {
    return sequelize.define(
        "user",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },

            status: {
                type: DataTypes.TEXT
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
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },

            status: {
                type: DataTypes.TEXT
            },

            type: {
                type: DataTypes.TEXT
            },

            name: {
                type: DataTypes.TEXT
            },

            accountNumber: {
                type: DataTypes.BIGINT,
                unique: true
            }
        }, {
            indexes: [
                { unique: true, fields: ["accountNumber"] }
            ]
        }
    )
}

export const accountAccess = (sequelize) => {
    return sequelize.define(
        "accountAccess",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },

            accountId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            userId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            access: {
                type: DataTypes.INTEGER,
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
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },

            accountId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            balance: {
                type: DataTypes.BIGINT,
                allowNull: false,
                default: 0
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