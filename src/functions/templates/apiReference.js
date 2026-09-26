import config from "#config" with { type: "json" }
import { embed } from "#functions/templates/templates"

const baseUrl = `${config.domain.replace(/\/$/, "")}/api/account/{accountNumber}`
const exampleCurrency = config.currencies[0]

const overview = embed(
    `${config.branding.abbreviation} API reference`,
    `Create or rotate a key with \`/business api account\` using your business account number. Every key is restricted to its selected business account. Send all account numbers as strings without spaces.\n\n**Base URL**\n\`${baseUrl}\`\n\n**Authentication**\nSend \`Authorization: Bearer <apiKey>\` with every request. JSON requests must also send \`Content-Type: application/json\`. Keep the key private; issuing another key invalidates the previous key.`
).addFields(
    {
        name: "Account information",
        value: `\`GET ${baseUrl}/info\`\nReturns the account name, number, type, status, and timestamps.`
    },
    {
        name: "Balances",
        value: `\`GET ${baseUrl}/balance\`\nReturns every currency balance held by the account.`
    },
    {
        name: "Transactions",
        value: `\`GET ${baseUrl}/transactions?limit=25&offset=0\`\nReturns incoming and outgoing transactions. \`limit\` accepts 1–100 and \`offset\` accepts 0–10000.`
    }
)

const payments = embed(
    "API payment requests",
    "Payment requests notify the Signatories of the selected paying account with Accept, Deny, and Block controls. A block applies between the paying and requesting accounts."
).addFields(
    {
        name: "Create a payment request",
        value: `\`POST ${baseUrl}/payment-requests\`\n\n\`\`\`json\n{\n  "targetAccountNumber": "11112222",\n  "amount": 15.00,\n  "currency": "${exampleCurrency}",\n  "reference": "Invoice"\n}\n\`\`\`\nReturns \`202 Accepted\` with the request ID and pending status.`
    },
    {
        name: "Check a payment request",
        value: `\`GET ${baseUrl}/payment-requests/{requestId}\`\nReturns the paying account number, status, amount, currency, reference, transaction ID when paid, and timestamps.`
    }
)

const paps = embed(
    "API pre authorised payments (PAPs)",
    "A creation request DMs every Holder of the paying account. Once authorized, the PAP is identified by the paying account number. Collections enforce its weekly limit, balance, and account status."
).addFields(
    {
        name: "Request a PAP",
        value: `\`POST ${baseUrl}/paps/requests\`\n\n\`\`\`json\n{\n  "payorAccountNumber": "11112222",\n  "currency": "${exampleCurrency}",\n  "weeklyLimit": 50.00,\n  "reference": "Membership"\n}\n\`\`\``
    },
    {
        name: "Check an authorization request",
        value: `\`GET ${baseUrl}/paps/requests/{requestId}\`\nReturns \`PENDING\`, \`AUTHORIZED\`, \`DECLINED\`, or \`DELIVERY_FAILED\`, plus the paying account and weekly limit.`
    },
    {
        name: "Check a PAP",
        value: `\`GET ${baseUrl}/paps/{accountNumber}\`\nReturns its status, payer, weekly limit, amount collected this week, and remaining weekly allowance.`
    },
    {
        name: "Take a payment",
        value: `\`POST ${baseUrl}/paps/{accountNumber}/take\`\n\n\`\`\`json\n{\n  "amount": 10.00,\n  "reference": "Invoice 1042"\n}\n\`\`\`\nReturns the resulting transaction and paying account number.`
    }
)

const responses = embed(
    "API responses and errors",
    "Successful requests return JSON. Failed requests use the structure below."
).addFields(
    {
        name: "Error format",
        value: "```json\n{\n  \"error\": {\n    \"code\": \"ERROR_CODE\",\n    \"message\": \"Description\"\n  }\n}\n```"
    },
    {
        name: "Common status codes",
        value: "`200` Success\n`202` Request accepted and sent\n`400` Invalid request body\n`401` Invalid API key\n`403` Account access denied or payment requests blocked\n`404` Account, request, or PAP not found\n`409` A matching request or PAP already exists\n`422` A weekly limit, balance, account status, or notification requirement prevented the operation\n`500` Service unavailable"
    }
)

export default {
    embeds: [overview, payments, paps, responses],
    allowedMentions: { parse: [] }
}
