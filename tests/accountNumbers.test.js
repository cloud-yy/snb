import assert from "node:assert/strict"
import { test } from "node:test"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Account } = await import("../src/models/models.js")
const { accountFromNumber, generateUniqueAccountNumber } = await import("../src/functions/db/account.js")
const { default: generateAccountNumber } = await import("../src/functions/util/generateAccountNumber.js")

test("account numbers contain the configured number of four-digit groups", t => {
    t.mock.method(Math, "random", () => 0.2345)

    const number = generateAccountNumber(4)

    assert.equal(number.length, 16)
    assert.match(number, /^\d{16}$/)
})

test("account number generation retries when the number already exists", async t => {
    const randomValues = [
        0.2345, 0.2345, 0.2345, 0.2345,
        0.6789, 0.6789, 0.6789, 0.6789
    ]
    const checkedNumbers = []
    const transaction = { id: "transaction" }

    t.mock.method(Math, "random", () => randomValues.shift())
    t.mock.method(Account, "findOne", async options => {
        checkedNumbers.push(options.where.number)
        assert.equal(options.transaction, transaction)
        return checkedNumbers.length === 1 ? { id: "existing" } : null
    })

    const number = await generateUniqueAccountNumber(4, transaction)

    assert.equal(checkedNumbers.length, 2)
    assert.notEqual(checkedNumbers[0], checkedNumbers[1])
    assert.equal(number, checkedNumbers[1])
    assert.equal(number.length, 16)
})

test("invalid account-number group counts are rejected", async () => {
    await assert.rejects(generateUniqueAccountNumber(0), {
        message: "INVALID_ACCOUNT_NUMBER_GROUPS"
    })
})

test("account lookup accepts the grouped number shown to customers", async t => {
    t.mock.method(Account, "findOne", async options => {
        assert.equal(options.where.number, "12345678")
        return { id: "1", number: "12345678" }
    })

    assert.equal((await accountFromNumber("1234 5678")).id, "1")
})
