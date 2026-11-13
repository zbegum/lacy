#!/usr/bin/env node
// Create a Lacy account.
//   npm run create-user -- --email ada@example.com --password secret --role expert --department Backend [--name "Ada"]
const { parseArgs } = require('node:util');
const { db } = require('../src/db');
const { createUser, ROLES } = require('../src/users');

async function main() {
    const { values } = parseArgs({
        options: {
            email: { type: 'string' },
            password: { type: 'string' },
            role: { type: 'string', default: 'learner' },
            department: { type: 'string' },
            name: { type: 'string' },
        },
    });
    if (!values.email || !values.password) {
        console.error(`Usage: npm run create-user -- --email <email> --password <password> [--role ${ROLES.join('|')}] [--department <dept>] [--name <name>]`);
        process.exitCode = 1;
        return;
    }
    await db.migrate.latest();
    const user = await createUser(values);
    console.log(`Created ${user.role} ${user.email} (id ${user.id})`);
}

main()
    .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    })
    .finally(() => db.destroy());
