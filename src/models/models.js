import { Sequelize } from "sequelize"

import { user, account, accountAccess, accountBalance } from "#models/banking"
import { auditLog, ledger } from "./logging"

const sequelize = new Sequelize(process.env.POSTGRES_URI, {
	dialect: "postgres",
	logging: false,
})

// General

const User = user(sequelize)
const Account = account(sequelize)

const AccountAccess = accountAccess(sequelize)
const AccountBalance = accountBalance(sequelize)

Account.belongsToMany(User, { through: AccountAccess, foreignKey: "accountId", as: "account" })
User.belongsToMany(Account, { through: AccountAccess, foreignKey: "userId", as: "user" })

Account.hasMany(AccountBalance, { foreignKey: "accountId", as: "balances" })
AccountBalance.belongsTo(Account, { foreignKey: "accountId", as: "account" })

// Logging

const AuditLog = auditLog(sequelize)
const Ledger = ledger(sequelize)

AuditLog.belongsTo(Account, { foreignKey: "accountId", as: "account" })
AuditLog.belongsTo(User, { foreignKey: "userId", as: "user" })

// Services



// Misc



export { sequelize, User }