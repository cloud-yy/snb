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

export const pap = (sequelize) => sequelize.define("pap", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    payorId: { type: DataTypes.BIGINT, allowNull: false },
    payeeId: { type: DataTypes.BIGINT, allowNull: false },
    authorizedById: { type: DataTypes.BIGINT, allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false },
    weeklyLimit: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "ACTIVE" }
}, {
    indexes: [
        { unique: true, fields: ["payorId", "payeeId"] },
        { fields: ["payeeId", "status"] }
    ]
})

export const papRequest = (sequelize) => sequelize.define("papRequest", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    payorId: { type: DataTypes.BIGINT, allowNull: false },
    payeeId: { type: DataTypes.BIGINT, allowNull: false },
    requestedById: { type: DataTypes.BIGINT, allowNull: false },
    processorId: { type: DataTypes.BIGINT },
    papId: { type: DataTypes.BIGINT },
    currency: { type: DataTypes.STRING, allowNull: false },
    weeklyLimit: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    reference: { type: DataTypes.STRING(100), allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "PENDING" }
}, {
    indexes: [
        { fields: ["payeeId", "status", "createdAt"] },
        { fields: ["payorId", "status"] }
    ]
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

export const businessApiKey = (sequelize) => sequelize.define("businessApiKey", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    accountId: { type: DataTypes.BIGINT, allowNull: false, unique: true },
    keyHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    createdById: { type: DataTypes.BIGINT, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE }
}, {
    indexes: [
        { unique: true, fields: ["accountId"] },
        { unique: true, fields: ["keyHash"] }
    ]
})

export const paymentRequest = (sequelize) => sequelize.define("paymentRequest", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    requesterId: { type: DataTypes.BIGINT, allowNull: false },
    targetAccountId: { type: DataTypes.BIGINT, allowNull: false },
    receivingAccountId: { type: DataTypes.BIGINT, allowNull: false },
    payingAccountId: { type: DataTypes.BIGINT },
    ledgerId: { type: DataTypes.BIGINT },
    amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    currency: { type: DataTypes.STRING, allowNull: false },
    reference: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "PENDING" },
    messageIds: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
}, {
    indexes: [
        { fields: ["targetAccountId", "status"] },
        { fields: ["receivingAccountId", "status"] },
        { fields: ["requesterId"] }
    ]
})

export const paymentRequestBlock = (sequelize) => sequelize.define("paymentRequestBlock", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    blockedAccountId: { type: DataTypes.BIGINT, allowNull: false },
    requestingAccountId: { type: DataTypes.BIGINT, allowNull: false }
}, {
    indexes: [
        { unique: true, fields: ["blockedAccountId", "requestingAccountId"] },
        { fields: ["requestingAccountId"] }
    ]
})
