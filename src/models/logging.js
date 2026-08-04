import { DataTypes } from "sequelize"

export const auditLog = (sequelize) => {
    return sequelize.define(
        "auditLog",
        {
            id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            action: {
                type: DataTypes.JSONB,
                allowNull: false
            },

            before: {
                type: DataTypes.JSONB
            },

            after: {
                type: DataTypes.JSONB
            },

            accountId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            userId: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            time: {
                type: DataTypes.DATE
            }
        }, {
            indexes: [
                { fields: ["accountId", "time"] },
                { fields: ["userId"] }
            ]
        }
    )
}

export const ledger = (sequelize) => {
    return sequelize.define(
        "ledger",
        {
            id: {
                type: DataTypes.BIGINT,
                primaryKey: true,
                autoIncrement: true
            },

            payor: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            payee: {
                type: DataTypes.INTEGER,
                allowNull: false
            },

            amount: {
                type: DataTypes.BIGINT,
                allowNull: false
            },

            currency: {
                type: DataTypes.STRING,
                allowNull: false
            },

            time: {
                type: DataTypes.DATE
            },

            status: {
                type: DataTypes.TEXT
            },

            type: {
                type: DataTypes.TEXT
            },

            reference: {
                type: DataTypes.TEXT
            },

            standingOrderId: {
                type: DataTypes.INTEGER
            },

            externalTransferId: {
                type: DataTypes.INTEGER
            },
        }, {
            indexes: [
                { fields: ["payor", "time"] },
                { fields: ["payee", "time"] }
            ]
        }
    )
}