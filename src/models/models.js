import { Sequelize } from "sequelize"

import user from "#models/user"
import { account, accountAccess, accountBalance } from "#models/banking"

const sequelize = new Sequelize(process.env.POSTGRES_URI, {
	dialect: "postgres",
	logging: false,
})

const User = user(sequelize)

const Account = account(sequelize)

const AccountAccess = accountAccess(sequelize)
const AccountBalance = accountBalance(sequelize)

Account.belongsToMany(User, {
    through: AccountAccess,
    foreignKey: "accountId",
    otherKey: "UserId"
})

User.belongsToMany(Account, {
    through: AccountAccess,
    foreignKey: "accountId",
    otherKey: "accountId"
})

Account.hasMany(AccountBalance, { foreignKey: "accountId", as: "balances" })
AccountBalance.belongsTo(Account, { foreignKey: "accountId", as: "account" })

export { sequelize, User }