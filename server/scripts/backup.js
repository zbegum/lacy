#!/usr/bin/env node
// Take a consistent backup while the server keeps running.
//
//   npm run backup                 -> ./backups/lacy-<date>/
//   npm run backup -- --out /path
//
// Copying the SQLite file with cp can catch it mid-write; VACUUM INTO asks SQLite
// itself for a clean copy. Podcast audio lives outside the database, so it is
// copied too — a backup without it loses the podcasts.
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('node:util');
const config = require('../src/config');
const { db } = require('../src/db');

async function main() {
    const { values } = parseArgs({ options: { out: { type: 'string' } } });

    // Local time, so the folder name matches the clock of whoever runs the backup.
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
    const target = path.resolve(values.out || path.join(process.cwd(), 'backups'), `lacy-${stamp}`);
    fs.mkdirSync(target, { recursive: true });

    const dbCopy = path.join(target, 'lacy.sqlite');
    await db.raw('VACUUM INTO ?', [dbCopy]);

    let audioFiles = 0;
    if (fs.existsSync(config.podcast.audioDir)) {
        const audioTarget = path.join(target, 'audio');
        fs.cpSync(config.podcast.audioDir, audioTarget, { recursive: true });
        audioFiles = fs.readdirSync(audioTarget).length;
    }

    const size = (fs.statSync(dbCopy).size / (1024 * 1024)).toFixed(1);
    console.log(`Backup written to ${target}`);
    console.log(`  lacy.sqlite  ${size} MB`);
    console.log(`  audio/       ${audioFiles} file${audioFiles === 1 ? '' : 's'}`);
    console.log('\nTo restore: stop the server, put lacy.sqlite back at DB_FILE and audio/ at AUDIO_DIR.');
}

main()
    .catch((err) => {
        console.error(`Backup failed: ${err.message}`);
        process.exitCode = 1;
    })
    .finally(() => db.destroy());
