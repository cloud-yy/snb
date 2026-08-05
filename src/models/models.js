import { Sequelize } from "sequelize"

import { user, account, accountAccess, accountBalance } from "#models/general"
import { auditLog, ledger } from "#models/logging"

const sequelize = new Sequelize(process.env.POSTGRES_URI, {
	dialect: "postgres",
	logging: false,
})

// General

const User = user(sequelize)
const Account = account(sequelize)

const AccountAccess = accountAccess(sequelize)
const AccountBalance = accountBalance(sequelize)

Account.belongsToMany(User, { through: AccountAccess, foreignKey: "accountId", as: "users" })
User.belongsToMany(Account, { through: AccountAccess, foreignKey: "userId", as: "accounts" })

Account.hasMany(AccountBalance, { foreignKey: "accountId", as: "balances" })
AccountBalance.belongsTo(Account, { foreignKey: "accountId", as: "account" })

// Logging

const AuditLog = auditLog(sequelize)
const Ledger = ledger(sequelize)

AuditLog.belongsTo(Account, { foreignKey: "accountId", as: "account" })
AuditLog.belongsTo(User, { foreignKey: "userId", as: "user" })

Account.hasMany(AuditLog, { foreignKey: "accountId", as: "auditLogs" })
User.hasMany(AuditLog, { foreignKey: "userId", as: "auditLogs" })

Ledger.belongsTo(Account, { foreignKey: "payorId", as: "payor" })
Ledger.belongsTo(Account, { foreignKey: "payeeId", as: "payee" })

Account.hasMany(Ledger, { foreignKey: "payorId", as: "ledgersPayor"})
Account.hasMany(Ledger, { foreignKey: "payeeId", as: "ledgersPayee"})

// Services



// Misc



export {
	sequelize,

	User,
	Account,

	AccountAccess,
	AccountBalance,
	
	AuditLog,
	Ledger
}