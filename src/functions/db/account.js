import { Account, AccountBalance, Ledger, sequelize } from "#models/models"
import config from "#config" with { type: 'json' }
import generateAccountNumber from "#functions/util/generateAccountNumber"

export async function createAccount(owner, type = "General", chosenName) {
    if (!owner) {
        return
    }

    const accountConfig = config.accounts?.[type]

    if (!accountConfig) {
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

            await owner.addAccount(account, {
                through: { access: "Holder" },
                transaction
            })

            await owner.createAuditLog({
                accountId: account.id,
                action: "ACCOUNT_CREATED",
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

export async function transfer(from, to, rawAmount, currency, reference, user, overdraft = false) {
    if (from.id === to.id) {
        throw new Error("SAME_ACCOUNT")
    }

    if (from.status === "FROZEN" || to.status === "FROZEN") {
        throw new Error("ACCOUNT_FROZEN")
    }

    if (typeof rawAmount !== "number" || !Number.isFinite(rawAmount)) {
        throw new Error("INVALID_AMOUNT")
    }

    const amount = Math.round(rawAmount * 100) / 100

    if (amount <= 0 || !Number.isFinite(amount)) {
        throw new Error("INVALID_AMOUNT")
    }

    return await sequelize.transaction(async transaction => {
        const fromFirst = String(from.id) < String(to.id)
        const firstAccount = fromFirst ? from : to
        const secondAccount = fromFirst ? to : from

        await AccountBalance.findOrCreate({
            where: {
                accountId: firstAccount.id,
                currency
            },
            transaction
        })

        const firstBalance = await AccountBalance.findOne({
            where: {
                accountId: firstAccount.id,
                currency
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        await AccountBalance.findOrCreate({
            where: {
                accountId: secondAccount.id,
                currency
            },
            transaction
        })

        const secondBalance = await AccountBalance.findOne({
            where: {
                accountId: secondAccount.id,
                currency
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })

        const fromBalance = fromFirst ? firstBalance : secondBalance
        const toBalance = fromFirst ? secondBalance : firstBalance

        if (fromBalance.balance < amount && !overdraft) {
            throw new Error("INSUFFICIENT_FUNDS")
        }

        let oldFromBalance = fromBalance.balance

        await fromBalance.increment("balance", {
            by: -amount,
            transaction
        })

        await toBalance.increment("balance", {
            by: amount,
            transaction
        })

        const ledger = await Ledger.create({
            payorId: from.id,
            payeeId: to.id,
            amount,
            currency,
            status: "SUCCESS",
            type: "TRANSFER",
            reference
        }, { transaction })

        if (user) {
            await fromBalance.reload({ transaction })

            await user.createAuditLog({
                action: "TRANSFER",
                before: { balance: oldFromBalance },
                after:  { balance: fromBalance.balance },
                accountId: from.id,
                ledgerId: ledger.id
            }, { transaction })
        }

        return ledger
    })
}

export async function accountFromNumber(number, transaction) {
    return await Account.findOne({where: { number }, ...transaction && { transaction }})
}
