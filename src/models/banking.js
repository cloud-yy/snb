import { DataTypes } from "sequelize"

export const account = (sequelize) => {
    return sequelize.define(
        "account",
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },
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

            permission: {
                type: DataTypes.INTEGER,
                allowNull: false
            }
        }, {
            indexes: [
                { unique: true, fields: ["accountId", "userId"] }
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
                type: DataTypes.STRING
            }
        }, {
            indexes: [
                { fields: ["accountId"] },
                { unique: true, fields: ["accountId", "currency"] }
            ]
        }
    )
}