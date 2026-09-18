import { Account, AccountAccess, AccountBalance, AuditLog, sequelize } from "#models/models"
import config from "#config" with { type: 'json' }
import generateAccountNumber from "#functions/util/generateAccountNumber"

export async function createAccount(owner, type = "General", chosenName) {
    const accountConfig = config.accounts?.[type]

    if (!config) {
        return
    }

    const name = chosenName || `${owner.robloxName}'s ${type} Account`

    try {
        const result = sequelize.transaction(async transaction => {
            const account = await Account.create({
                status: "ACTIVE",
                type,
                name,
                number: await generateAccountNumber(4)
            }, {transaction})

            if (owner) {
                await AccountAccess.create({
                    accountId: account.id,
                    userId: owner.id,
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
                userId: owner.id,
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