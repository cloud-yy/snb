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

Account.belongsToMany(User, { through: AccountAccess, foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })
User.belongsToMany(Account, { through: AccountAccess, foreignKey: "userId", onDelete: "CASCADE", onUpdate: "CASCADE" })

Account.hasMany(AccountBalance, { foreignKey: "accountId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
AccountBalance.belongsTo(Account, { foreignKey: "accountId", onDelete: "RESTRICT", onUpdate: "CASCADE" })

// Logging

const AuditLog = auditLog(sequelize)
const Ledger = ledger(sequelize)

AuditLog.belongsTo(Account, { foreignKey: "accountId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
AuditLog.belongsTo(User, { foreignKey: "userId", onDelete: "SET NULL", onUpdate: "CASCADE" })
AuditLog.belongsTo(Ledger, { foreignKey: "ledgerId", onDelete: "RESTRICT", onUpdate: "CASCADE" })

Account.hasMany(AuditLog, { foreignKey: "accountId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
User.hasMany(AuditLog, { foreignKey: "userId", onDelete: "SET NULL", onUpdate: "CASCADE" })

Ledger.belongsTo(Account, { as: "payor", foreignKey: "payorId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
Ledger.belongsTo(Account, { as: "payee", foreignKey: "payeeId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
Ledger.hasMany(AuditLog, { foreignKey: "ledgerId", onDelete: "RESTRICT", onUpdate: "CASCADE" })

Account.hasMany(Ledger, { as: "outgoingLedgers", foreignKey: "payorId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
Account.hasMany(Ledger, { as: "incomingLedgers", foreignKey: "payeeId", onDelete: "RESTRICT", onUpdate: "CASCADE" })

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
