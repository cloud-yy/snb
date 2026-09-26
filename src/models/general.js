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
    type: { type: DataTypes.STRING, allowNull: false, defaultValue: "WITHDRAWAL" },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "PENDING" },
    messageId: { type: DataTypes.STRING },
    processorId: { type: DataTypes.BIGINT },
    ledgerId: { type: DataTypes.BIGINT }
}, {
    indexes: [{ fields: ["accountId", "status"] }, { fields: ["requesterId"] }]
})

export const directDebit = (sequelize) => sequelize.define("directDebit", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    payorId: { type: DataTypes.BIGINT, allowNull: false },
    payeeId: { type: DataTypes.BIGINT, allowNull: false },
    authorizedById: { type: DataTypes.BIGINT, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false },
    maxAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    weeklyLimit: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    totalLimit: { type: DataTypes.DECIMAL(10, 2) },
    totalCollected: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "ACTIVE" }
}, {
    indexes: [{ fields: ["payorId", "status"] }, { fields: ["payeeId", "status"] }]
})

export const businessLog = (sequelize) => sequelize.define("businessLog", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    accountId: { type: DataTypes.BIGINT, allowNull: false },
    guildId: { type: DataTypes.STRING, allowNull: false },
    auditChannelId: { type: DataTypes.STRING },
    transactionChannelId: { type: DataTypes.STRING }
}, {
    indexes: [
        { unique: true, fields: ["accountId", "guildId"] },
        { fields: ["auditChannelId"] },
        { fields: ["transactionChannelId"] }
    ]
})

export const paymentRequest = (sequelize) => sequelize.define("paymentRequest", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    requesterId: { type: DataTypes.BIGINT, allowNull: false },
    targetId: { type: DataTypes.BIGINT, allowNull: false },
    receivingAccountId: { type: DataTypes.BIGINT, allowNull: false },
    payingAccountId: { type: DataTypes.BIGINT },
    ledgerId: { type: DataTypes.BIGINT },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false },
    reference: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "PENDING" },
    messageId: { type: DataTypes.STRING }
}, {
    indexes: [
        { fields: ["targetId", "status"] },
        { fields: ["receivingAccountId", "status"] },
        { fields: ["requesterId"] }
    ]
})

export const paymentRequestBlock = (sequelize) => sequelize.define("paymentRequestBlock", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    blockedUserId: { type: DataTypes.BIGINT, allowNull: false },
    requestingAccountId: { type: DataTypes.BIGINT, allowNull: false }
}, {
    indexes: [
        { unique: true, fields: ["blockedUserId", "requestingAccountId"] },
        { fields: ["requestingAccountId"] }
    ]
})
