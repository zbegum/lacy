// Tours are grouped by the project's git remote rather than the folder name, so
// two people who cloned the same repository into differently named folders see
// the same tours. Existing rows keep working through their project_name.

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
    await knex.schema.alterTable('tour', (t) => {
        t.string('project_key', 512);
        t.index(['project_key']);
    });
    // Backfill: before this, the folder name was the identity.
    await knex('tour').whereNull('project_key').update({
        project_key: knex.raw('LOWER(project_name)'),
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
    await knex.schema.alterTable('tour', (t) => {
        t.dropIndex(['project_key']);
        t.dropColumn('project_key');
    });
};
