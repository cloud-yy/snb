import { Sequelize } from "sequelize"

import { user } from "#models/user"
import { account, accountAccess, accountBalance } from "#models/general"
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

Account.belongsToMany(User, { through: AccountAccess, foreignKey: "accountId" })
User.belongsToMany(Account, { through: AccountAccess, foreignKey: "userId" })

Account.hasMany(AccountBalance, { foreignKey: "accountId" })
AccountBalance.belongsTo(Account, { foreignKey: "accountId" })

// Logging

const AuditLog = auditLog(sequelize)
const Ledger = ledger(sequelize)

AuditLog.belongsTo(Account, { foreignKey: "accountId" })
AuditLog.belongsTo(User, { foreignKey: "userId" })

Account.hasMany(AuditLog, { foreignKey: "accountId" })
User.hasMany(AuditLog, { foreignKey: "userId" })

Ledger.belongsTo(Account, { foreignKey: "payorId" })
Ledger.belongsTo(Account, { foreignKey: "payeeId" })

Account.hasMany(Ledger, { foreignKey: "payorId"})
Account.hasMany(Ledger, { foreignKey: "payeeId"})

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