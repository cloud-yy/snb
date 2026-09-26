import { DataTypes } from "sequelize"

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
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            accountId: {
                type: DataTypes.BIGINT,
                allowNull: false
            },

            balance: {
                type: DataTypes.DECIMAL(10, 2),
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

export const withdrawal = (sequelize) => sequelize.define("withdrawal", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    requesterId: { type: DataTypes.BIGINT, allowNull: false },
    accountId: { type: DataTypes.BIGINT, allowNull: false },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: "HC$" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "PENDING" },
    messageId: { type: DataTypes.STRING },
    processorId: { type: DataTypes.BIGINT },
    ledgerId: { type: DataTypes.BIGINT }
}, {
    indexes: [{ fields: ["accountId", "status"] }, { fields: ["requesterId"] }]
})
