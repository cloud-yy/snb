import { Account, AccountAccess, AccountBalance, sequelize } from "#models/models"
import config from "#config"

export async function createAccount(owner, type = "General", name) {
    const accountConfig = config.accounts?.[type]

    if (!config) {
        return
    }

    const name = name || `${type} Account`

    try {
        const result = sequelize.transaction(async transaction => {
            const account = await Account.create({
                status: "ACTIVE",
                type,
                name
            }, {transaction})

            if (owner) {
                await AccountAccess.create({
                    accountId: account.id,
                    owner: owner.id,
                    access: "Holder"
                }, {transaction})
            }

            await AccountBalance.bulkCreate(
                config.currencies.map(currency => ({
                    accountId: account.id,
                    currency,
                    balance: 0
                })), {transaction}
            )

            await AuditLog.create({
                accountId: account.id,
                userId: user.id,
                action: {
                    type: "ACCOUNT_CREATED"
                },
                before: null,
                after: account.toJSON()
            }, {transaction})

            return account
        })

        return result
    } catch (error) {
        console.error(error)

        return null
    }
}