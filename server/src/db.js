// Database access through Knex over SQLite.
const knex = require('knex');
const knexConfig = require('../knexfile');

const db = knex(knexConfig);

// Insert one row and return its generated id.
async function insertAndGetId(table, row, idColumn = 'id', trx = db) {
    const result = await trx(table).insert(row, [idColumn]);
    const first = Array.isArray(result) ? result[0] : result;
    return typeof first === 'object' && first !== null ? first[idColumn] : first;
}

// Update the matching row, insert when nothing matched.
async function upsert(table, keys, values, trx = db) {
    const updated = await trx(table).where(keys).update(values);
    if (!updated) {
        await trx(table).insert({ ...keys, ...values });
    }
}

module.exports = { db, insertAndGetId, upsert };
