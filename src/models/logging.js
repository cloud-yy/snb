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
                type: DataTypes.BIGINT,
                allowNull: false
            },

            userId: {
                type: DataTypes.BIGINT,
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

            payorId: {
                type: DataTypes.BIGINT,
                allowNull: false
            },

            payeeId: {
                type: DataTypes.BIGINT,
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
                type: DataTypes.BIGINT
            },

            externalTransferId: {
                type: DataTypes.BIGINT
            },
        }, {
            indexes: [
                { fields: ["payorId", "time"] },
                { fields: ["payeeId", "time"] }
            ]
        }
    )
}