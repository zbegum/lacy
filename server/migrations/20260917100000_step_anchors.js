// Remember the code a step points at, so it can be found again when the file
// has been edited or the reader is on a different branch.

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
    await knex.schema.alterTable('tour_steps', (t) => {
        t.text('anchor_text');
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
    await knex.schema.alterTable('tour_steps', (t) => {
        t.dropColumn('anchor_text');
    });
};
