import { createHash, randomBytes } from "node:crypto"
import { Op } from "sequelize"
import config from "#config" with { type: "json" }
import { Account, AccountAccess, BusinessApiKey, User, sequelize } from "#models/models"
import { queueAuditLogNotification } from "#functions/util/auditLogNotifications"

export function hashBusinessApiKey(apiKey) {
    return createHash("sha256").update(apiKey).digest("hex")
}

export function businessApiKeyPrefix() {
    return config.branding.abbreviation.toLowerCase().replace(/[^a-z0-9]/g, "") || "bank"
}

export async function issueBusinessApiKey(actor, account) {
    if (!actor || !account) throw new Error("ACCOUNT_UNAVAILABLE")

    const apiKey = `${businessApiKeyPrefix()}_${randomBytes(32).toString("base64url")}`
    const keyHash = hashBusinessApiKey(apiKey)

    await sequelize.transaction(async transaction => {
        const lockedAccount = await Account.findByPk(account.id, {
            attributes: ["id", "type", "status"],
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!lockedAccount || config.accounts?.[lockedAccount.type]?.type !== "business" || lockedAccount.status === "CLOSED") {
            throw new Error("BUSINESS_ACCOUNT_REQUIRED")
        }

        const access = await AccountAccess.findOne({
            attributes: ["id"],
            where: {
                accountId: lockedAccount.id,
                userId: actor.id,
                access: { [Op.gte]: config.accountAccesses.Manager }
            },
            transaction
        })
        if (!access) throw new Error("MANAGER_ACCESS_REQUIRED")

        const [storedKey, created] = await BusinessApiKey.findOrCreate({
            where: { accountId: lockedAccount.id },
            defaults: { keyHash, createdById: actor.id },
            transaction
        })
        await storedKey.update({ keyHash, createdById: actor.id, lastUsedAt: null }, { transaction })

        const auditLog = await actor.createAuditLog({
            accountId: lockedAccount.id,
            action: "BUSINESS_API_KEY_ISSUED",
            before: null,
            after: { rotated: !created }
        }, { transaction })
        queueAuditLogNotification(auditLog, transaction, { central: false })
    })

    return apiKey
}

export async function businessApiContextForKey(apiKey) {
    if (typeof apiKey !== "string" || !/^[A-Za-z0-9]+_[A-Za-z0-9_-]+$/.test(apiKey) || apiKey.length > 100) return null

    const storedKey = await BusinessApiKey.findOne({
        where: { keyHash: hashBusinessApiKey(apiKey) },
        include: [
            { model: Account, attributes: ["id", "name", "number", "status", "type", "createdAt", "updatedAt"] },
            { model: User, as: "creator", attributes: ["id", "discordId"] }
        ]
    })
    if (!storedKey?.account || !storedKey.creator) return null
    if (config.accounts?.[storedKey.account.type]?.type !== "business") return null

    await storedKey.update({ lastUsedAt: new Date() })
    return { account: storedKey.account, actor: storedKey.creator }
}

export async function accountForBusinessApiKey(apiKey) {
    return (await businessApiContextForKey(apiKey))?.account || null
}
