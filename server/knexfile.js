// Knex configuration shared by the server and the migration CLI.
const fs = require('fs');
const path = require('path');
const { db } = require('./src/config');

fs.mkdirSync(path.dirname(db.file), { recursive: true });

module.exports = {
    client: 'better-sqlite3',
    connection: { filename: db.file },
    useNullAsDefault: true,
    pool: {
        afterCreate: (conn, done) => {
            // Foreign keys are off by default in SQLite; WAL lets reads continue
            // during writes, which matters once a few people use the same server.
            conn.pragma('foreign_keys = ON');
            conn.pragma('journal_mode = WAL');
            done();
        },
    },
    migrations: { directory: path.resolve(__dirname, 'migrations') },
};
