import { col, fn, Op } from "sequelize"
import { Ledger } from "#models/models"
import config from "#config" with { type: "json" }

const weekdays = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

function zonedParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        weekday: "short"
    }).formatToParts(date)

    return Object.fromEntries(parts.map(part => [part.type, part.value]))
}

function localMidnightUtc(year, month, day, timeZone) {
    const desired = Date.UTC(year, month - 1, day)
    let timestamp = desired

    for (let attempt = 0; attempt < 3; attempt++) {
        const actual = zonedParts(new Date(timestamp), timeZone)
        const represented = Date.UTC(
            Number(actual.year),
            Number(actual.month) - 1,
            Number(actual.day),
            Number(actual.hour),
            Number(actual.minute),
            Number(actual.second)
        )
        timestamp += desired - represented
    }

    return new Date(timestamp)
}

export function currentWeekStart(now = Date.now(), timeZone = config.timezone) {
    const current = zonedParts(new Date(now), timeZone)
    const localDate = new Date(Date.UTC(
        Number(current.year),
        Number(current.month) - 1,
        Number(current.day) - weekdays[current.weekday]
    ))

    return localMidnightUtc(
        localDate.getUTCFullYear(),
        localDate.getUTCMonth() + 1,
        localDate.getUTCDate(),
        timeZone
    )
}

async function totalsFor(where, since) {
    return Ledger.findAll({
        attributes: ["currency", [fn("SUM", col("amount")), "total"]],
        where: {
            ...where,
            status: "SUCCESS",
            createdAt: { [Op.gte]: since }
        },
        group: ["currency"],
        order: [["currency", "ASC"]],
        raw: true
    })
}

export async function currentWeekAccountActivity(accountId, now = Date.now(), timeZone = config.timezone) {
    const since = currentWeekStart(now, timeZone)
    const [incoming, outgoing] = await Promise.all([
        totalsFor({ payeeId: accountId }, since),
        totalsFor({ payorId: accountId }, since)
    ])

    return { incoming, outgoing, since }
}
