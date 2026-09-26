import { Sequelize } from "sequelize"

import { user } from "#models/user"
import {
	account, accountAccess, accountBalance, pap, papRequest, businessLog, businessApiKey,
	paymentRequest, paymentRequestBlock
} from "#models/general"
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
const Pap = pap(sequelize)
const PapRequest = papRequest(sequelize)
const BusinessLog = businessLog(sequelize)
const BusinessApiKey = businessApiKey(sequelize)
const PaymentRequest = paymentRequest(sequelize)
const PaymentRequestBlock = paymentRequestBlock(sequelize)

AuditLog.belongsTo(Account, { foreignKey: "accountId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
AuditLog.belongsTo(User, { foreignKey: "userId", onDelete: "SET NULL", onUpdate: "CASCADE" })
AuditLog.belongsTo(Ledger, { foreignKey: "ledgerId", onDelete: "RESTRICT", onUpdate: "CASCADE" })

Account.hasMany(AuditLog, { foreignKey: "accountId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
User.hasMany(AuditLog, { foreignKey: "userId", onDelete: "SET NULL", onUpdate: "CASCADE" })

Ledger.belongsTo(Account, { as: "payor", foreignKey: "payorId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
Ledger.belongsTo(Account, { as: "payee", foreignKey: "payeeId", onDelete: "RESTRICT", onUpdate: "CASCADE" })
Ledger.hasMany(AuditLog, { foreignKey: "ledgerId", onDelete: "RESTRICT", onUpdate: "CASCADE" })

Pap.belongsTo(Account, { as: "payor", foreignKey: "payorId", onDelete: "RESTRICT" })
Pap.belongsTo(Account, { as: "payee", foreignKey: "payeeId", onDelete: "RESTRICT" })
Pap.belongsTo(User, { as: "authorizer", foreignKey: "authorizedById", onDelete: "RESTRICT" })
Ledger.belongsTo(Pap, { foreignKey: "papId", onDelete: "RESTRICT" })

PapRequest.belongsTo(Account, { as: "payor", foreignKey: "payorId", onDelete: "RESTRICT" })
PapRequest.belongsTo(Account, { as: "payee", foreignKey: "payeeId", onDelete: "RESTRICT" })
PapRequest.belongsTo(User, { as: "requester", foreignKey: "requestedById", onDelete: "RESTRICT" })
PapRequest.belongsTo(User, { as: "processor", foreignKey: "processorId", onDelete: "SET NULL" })
PapRequest.belongsTo(Pap, { as: "pap", foreignKey: "papId", onDelete: "SET NULL" })

BusinessLog.belongsTo(Account, { foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })
Account.hasMany(BusinessLog, { foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })

BusinessApiKey.belongsTo(Account, { foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })
BusinessApiKey.belongsTo(User, { as: "creator", foreignKey: "createdById", onDelete: "RESTRICT", onUpdate: "CASCADE" })
Account.hasOne(BusinessApiKey, { foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })

PaymentRequest.belongsTo(User, { as: "requester", foreignKey: "requesterId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Account, { as: "targetAccount", foreignKey: "targetAccountId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Account, { as: "receivingAccount", foreignKey: "receivingAccountId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Account, { as: "payingAccount", foreignKey: "payingAccountId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Ledger, { foreignKey: "ledgerId", onDelete: "RESTRICT" })

PaymentRequestBlock.belongsTo(Account, { as: "blockedAccount", foreignKey: "blockedAccountId", onDelete: "CASCADE" })
PaymentRequestBlock.belongsTo(Account, { as: "requestingAccount", foreignKey: "requestingAccountId", onDelete: "CASCADE" })

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
	Ledger,
	Pap,
	PapRequest,
	BusinessLog,
	BusinessApiKey,
	PaymentRequest,
	PaymentRequestBlock
}
