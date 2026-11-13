// Initial Lacy schema, ported from the original SQL Server script.
//
// Deleting a tour cascades to its steps, quiz, assignments and podcast audio;
// deleting a user cascades to the tours they created and their own progress rows.

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
    await knex.schema.createTable('users', (t) => {
        t.increments('id').primary();
        t.string('email', 255).notNullable().unique();
        t.string('password_hash', 255).notNullable();
        t.string('name', 100);
        t.string('department', 100);
        t.string('role', 20).notNullable().defaultTo('learner');
        t.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('tour', (t) => {
        t.increments('id').primary();
        t.string('name', 255).notNullable();
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.integer('isGuided').notNullable().defaultTo(0);
        t.string('target_department', 100);
        t.string('tour_focus', 255);
        t.string('project_name', 255);
        t.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('tour_steps', (t) => {
        t.increments('id').primary();
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('step_number').notNullable();
        t.text('description').notNullable();
        t.string('file_path', 1024);
        t.integer('line_start');
        t.integer('line_end');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.index(['tour_id', 'step_number']);
    });

    await knex.schema.createTable('tour_assignment', (t) => {
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.string('tour_status', 20).notNullable().defaultTo('assigned');
        t.text('feedback');
        t.integer('rating');
        t.integer('time_spent').defaultTo(0);
        t.primary(['tour_id', 'user_id']);
    });

    await knex.schema.createTable('tour_quiz', (t) => {
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('learner_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.integer('total_score').defaultTo(0);
        t.timestamp('start_at').defaultTo(knex.fn.now());
        t.timestamp('ended_at').nullable();
        t.primary(['tour_id', 'learner_id']);
    });

    // question_id is the question's position within its tour.
    await knex.schema.createTable('quiz_questions', (t) => {
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('question_id').notNullable();
        t.integer('score').defaultTo(0);
        t.text('question').notNullable();
        t.text('options'); // JSON array
        t.text('answers'); // JSON array
        t.string('question_type', 20);
        t.primary(['tour_id', 'question_id']);
    });

    await knex.schema.createTable('quiz_answers', (t) => {
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.integer('question_id').notNullable();
        t.text('answer').notNullable(); // JSON
        t.primary(['tour_id', 'user_id', 'question_id']);
    });

    // Learner questions asked during a guided tour, answered by the expert.
    await knex.schema.createTable('questions', (t) => {
        t.increments('question_id').primary();
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('step_no').notNullable();
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.text('question').notNullable();
        t.text('answer');
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('answered_at').nullable();
    });

    await knex.schema.createTable('voice_tours', (t) => {
        t.increments('id').primary();
        t.integer('tour_id').unsigned().notNullable().unique()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.text('audio_text');
        t.timestamp('created_at').defaultTo(knex.fn.now());
    });

    await knex.schema.createTable('voice_tour_segments', (t) => {
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('segment_index').notNullable();
        t.string('role', 20).notNullable();
        t.binary('audio_blob');
        t.primary(['tour_id', 'segment_index']);
    });

    // Research telemetry: how long learners spend in a tour and where they exit.
    await knex.schema.createTable('tour_usage', (t) => {
        t.increments('id').primary();
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.timestamp('enter_timestamp').nullable();
        t.timestamp('exit_timestamp').nullable();
        t.integer('exit_step_id'); // not a foreign key: steps may be deleted later
    });

    await knex.schema.createTable('edit_history', (t) => {
        t.increments('id').primary();
        t.integer('tour_id').unsigned().notNullable()
            .references('id').inTable('tour').onDelete('CASCADE');
        t.integer('user_id').unsigned().notNullable()
            .references('id').inTable('users').onDelete('CASCADE');
        t.timestamp('start_time').nullable();
        t.timestamp('end_time').nullable();
        t.integer('number_of_edit_actions').defaultTo(0);
    });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
    for (const table of [
        'edit_history', 'tour_usage', 'voice_tour_segments', 'voice_tours', 'questions',
        'quiz_answers', 'quiz_questions', 'tour_quiz', 'tour_assignment', 'tour_steps',
        'tour', 'users',
    ]) {
        await knex.schema.dropTableIfExists(table);
    }
};
