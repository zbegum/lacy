// Session tokens for API authentication.
//
// Two kinds of row:
//   session  - a long-lived API token, issued at login
//   handoff  - a short-lived, single-use code used to open the dashboard in a
//              browser from the extension, exchanged immediately for a session
//
// Only the SHA-256 hash of a token is stored, so a database leak does not hand
// anyone a working credential.

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
    await knex.schema.createTable('sessions', (t) => {
        t.increments('id').primary();
        t.string('token_hash', 64).notNullable().unique();
        t.string('kind', 20).notNullable().defaultTo('session');
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.timestamp('expires_at').notNullable();
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['user_id']);
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists('sessions');
};
