// What people actually find when they open a step: whether the code is still
// where the tour says it is. Reported by the extension as learners take tours,
// so the expert who wrote the tour can see which steps have gone stale.

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
    await knex.schema.createTable('step_health', (t) => {
        t.integer('step_id').unsigned().primary()
            .references('id').inTable('tour_steps').onDelete('CASCADE');
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        // exact | moved | changed | missing
        t.string('status', 20).notNullable();
        t.integer('reported_by').unsigned()
            .references('id').inTable('users').onDelete('CASCADE');
        t.timestamp('reported_at').notNullable();
        t.index(['tour_id']);
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
    await knex.schema.dropTableIfExists('step_health');
};
