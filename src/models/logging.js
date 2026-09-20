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
                type: DataTypes.STRING,
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
                type: DataTypes.BIGINT
            },

            ledgerId: {
                type: DataTypes.BIGINT,
            },
        }, {
            indexes: [
                { fields: ["accountId", "createdAt"] },
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
                type: DataTypes.DECIMAL(10, 2),
                allowNull: false
            },

            currency: {
                type: DataTypes.STRING,
                allowNull: false
            },

            status: {
                type: DataTypes.TEXT,
                allowNull: false
            },

            type: {
                type: DataTypes.TEXT,
                allowNull: false
            },

            reference: {
                type: DataTypes.TEXT,
                allowNull: false
            },

            standingOrderId: {
                type: DataTypes.BIGINT
            },

            directDebitId: {
                type: DataTypes.BIGINT
            },

            externalTransferId: {
                type: DataTypes.BIGINT
            },
        }, {
            indexes: [
                { fields: ["payorId", "createdAt"] },
                { fields: ["payeeId", "createdAt"] }
            ]
        }
    )
}