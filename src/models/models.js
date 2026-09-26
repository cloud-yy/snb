import { Sequelize } from "sequelize"

import { user } from "#models/user"
import {
	account, accountAccess, accountBalance, withdrawal, directDebit, businessLog,
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
const Withdrawal = withdrawal(sequelize)
const DirectDebit = directDebit(sequelize)
const BusinessLog = businessLog(sequelize)
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

Withdrawal.belongsTo(Account, { foreignKey: "accountId", onDelete: "RESTRICT" })
Withdrawal.belongsTo(User, { as: "requester", foreignKey: "requesterId", onDelete: "RESTRICT" })
Withdrawal.belongsTo(User, { as: "processor", foreignKey: "processorId", onDelete: "SET NULL" })
Withdrawal.belongsTo(Ledger, { foreignKey: "ledgerId", onDelete: "RESTRICT" })

DirectDebit.belongsTo(Account, { as: "payor", foreignKey: "payorId", onDelete: "RESTRICT" })
DirectDebit.belongsTo(Account, { as: "payee", foreignKey: "payeeId", onDelete: "RESTRICT" })
DirectDebit.belongsTo(User, { as: "authorizer", foreignKey: "authorizedById", onDelete: "RESTRICT" })
Ledger.belongsTo(DirectDebit, { foreignKey: "directDebitId", onDelete: "RESTRICT" })

BusinessLog.belongsTo(Account, { foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })
Account.hasMany(BusinessLog, { foreignKey: "accountId", onDelete: "CASCADE", onUpdate: "CASCADE" })

PaymentRequest.belongsTo(User, { as: "requester", foreignKey: "requesterId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(User, { as: "target", foreignKey: "targetId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Account, { as: "receivingAccount", foreignKey: "receivingAccountId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Account, { as: "payingAccount", foreignKey: "payingAccountId", onDelete: "RESTRICT" })
PaymentRequest.belongsTo(Ledger, { foreignKey: "ledgerId", onDelete: "RESTRICT" })

PaymentRequestBlock.belongsTo(User, { as: "blockedUser", foreignKey: "blockedUserId", onDelete: "CASCADE" })
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
	Withdrawal,
	DirectDebit,
	BusinessLog,
	PaymentRequest,
	PaymentRequestBlock
}
