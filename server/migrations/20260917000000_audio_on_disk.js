// Podcast audio moves out of the database and onto disk: the SQLite file no
// longer grows by megabytes per podcast, and backups can treat audio separately.
// Any audio already stored as a blob is written out on first read.

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
    await knex.schema.alterTable('voice_tour_segments', (t) => {
        t.string('audio_path', 512);
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
    await knex.schema.alterTable('voice_tour_segments', (t) => {
        t.dropColumn('audio_path');
    });
};
