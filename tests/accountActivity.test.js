import assert from "node:assert/strict"
import { test } from "node:test"
import { Op } from "sequelize"

process.env.POSTGRES_URI ||= "postgres://test:test@localhost:5432/test"

const { Ledger } = await import("../src/models/models.js")
const { currentWeekAccountActivity, currentWeekStart } = await import("../src/functions/util/accountActivity.js")

test("current-week account activity totals transactions since Monday", async t => {
    const calls = []
    const now = Date.UTC(2026, 8, 26, 12)

    t.mock.method(Ledger, "findAll", async options => {
        calls.push(options)
        return options.where.payeeId
            ? [{ currency: "HC$", total: "125.50" }]
            : [{ currency: "HC$", total: "40.25" }]
    })

    const result = await currentWeekAccountActivity("42", now, "UTC")

    assert.deepEqual(result.incoming, [{ currency: "HC$", total: "125.50" }])
    assert.deepEqual(result.outgoing, [{ currency: "HC$", total: "40.25" }])
    assert.equal(calls[0].where.payeeId, "42")
    assert.equal(calls[1].where.payorId, "42")

    for (const call of calls) {
        assert.equal(call.where.status, "SUCCESS")
        assert.equal(call.where.createdAt[Op.gte].toISOString(), "2026-09-21T00:00:00.000Z")
        assert.deepEqual(call.group, ["currency"])
        assert.equal(call.raw, true)
    }
})

test("the Monday boundary follows Europe/London daylight saving time", () => {
    const duringBritishSummerTime = Date.UTC(2026, 8, 23, 12)
    const duringGreenwichMeanTime = Date.UTC(2026, 11, 2, 12)

    assert.equal(
        currentWeekStart(duringBritishSummerTime, "Europe/London").toISOString(),
        "2026-09-20T23:00:00.000Z"
    )
    assert.equal(
        currentWeekStart(duringGreenwichMeanTime, "Europe/London").toISOString(),
        "2026-11-30T00:00:00.000Z"
    )
})
