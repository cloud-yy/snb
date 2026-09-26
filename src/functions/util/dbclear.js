import { QueryTypes, Sequelize } from "sequelize"

if (!process.env.POSTGRES_URI) throw new Error("POSTGRES_URI is required to clear the database.")

const sequelize = new Sequelize(process.env.POSTGRES_URI, {
    dialect: "postgres",
    logging: false
})

try {
    const count = await sequelize.transaction(async transaction => {
        const tables = await sequelize.query(`
            SELECT format('%I.%I', schemaname, tablename) AS name
            FROM pg_tables
            WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
                AND schemaname !~ '^pg_(toast|temp)_'
            ORDER BY schemaname, tablename
        `, { type: QueryTypes.SELECT, transaction })

        if (tables.length) {
            await sequelize.query(`DROP TABLE IF EXISTS ${tables.map(table => table.name).join(", ")} CASCADE`, { transaction })
        }

        return tables.length
    })

    console.log(`Dropped ${count} database table(s).`)
} finally {
    await sequelize.close()
}
