#!/usr/bin/env node
// Account management for a self-hosted Lacy server.
//
//   npm run users -- list
//   npm run users -- reset-password --email ada@example.com --password 'new secret'
//   npm run users -- set-role --email ada@example.com --role expert
//   npm run users -- delete --email ada@example.com
//
// Creating accounts lives in create-user.js (npm run create-user).
const { parseArgs } = require('node:util');
const { db } = require('../src/db');
const {
    ROLES, listUsers, findByEmail, setPassword, deleteUser, countToursOwned, reassignTours,
} = require('../src/users');

const USAGE = `Usage:
  npm run users -- list
  npm run users -- reset-password --email <email> --password <password>
  npm run users -- set-role --email <email> --role ${ROLES.join('|')}
  npm run users -- delete --email <email> [--reassign-to <email>] [--yes]
  npm run users -- transfer-tours --email <email> --reassign-to <email>

Deleting an account also deletes the tours it owns, so --reassign-to hands them
to someone else first. Use --force to delete the tours along with the account.`;

async function requireUser(email) {
    if (!email) throw new Error('--email is required');
    const user = await findByEmail(email);
    if (!user) throw new Error(`No account found for ${email}`);
    return user;
}

const commands = {
    async list() {
        const users = await listUsers();
        if (users.length === 0) {
            console.log('No accounts yet. Create one with: npm run create-user -- --email ... --password ...');
            return;
        }
        const width = Math.max(...users.map((u) => u.email.length));
        for (const u of users) {
            console.log(`${String(u.id).padStart(3)}  ${u.email.padEnd(width)}  ${u.role.padEnd(7)}  ${u.department || '-'}`);
        }
    },

    async 'reset-password'({ email, password }) {
        const user = await requireUser(email);
        if (!password) throw new Error('--password is required');
        await setPassword(user.id, password);
        console.log(`Password updated for ${user.email}`);
    },

    async 'set-role'({ email, role }) {
        const user = await requireUser(email);
        if (!ROLES.includes(role)) throw new Error(`--role must be one of: ${ROLES.join(', ')}`);
        await db('users').where({ id: user.id }).update({ role });
        console.log(`${user.email} is now ${role}`);
    },

    async 'transfer-tours'({ email, 'reassign-to': to }) {
        const from = await requireUser(email);
        const target = await requireUser(to);
        const moved = await reassignTours(from.id, target.id);
        console.log(`Moved ${moved} tour${moved === 1 ? '' : 's'} from ${from.email} to ${target.email}`);
    },

    async delete({ email, 'reassign-to': to, yes, force }) {
        const user = await requireUser(email);
        const owned = await countToursOwned(user.id);

        if (owned > 0 && !to && !force) {
            console.log(`${user.email} wrote ${owned} tour${owned === 1 ? '' : 's'}.`);
            console.log('Deleting the account would delete those tours and everyone\'s progress on them.');
            console.log(`Hand them over:  npm run users -- delete --email ${user.email} --reassign-to <email> --yes`);
            console.log('Or delete both:  add --force');
            process.exitCode = 1;
            return;
        }

        if (!yes) {
            const consequence = owned > 0 && !to
                ? `along with ${owned} tour${owned === 1 ? '' : 's'} and everyone's progress on them`
                : 'and their own progress';
            console.log(`This deletes ${user.email} ${consequence}.`);
            console.log('Re-run with --yes to confirm.');
            return;
        }

        if (to) {
            const target = await requireUser(to);
            const moved = await reassignTours(user.id, target.id);
            console.log(`Moved ${moved} tour${moved === 1 ? '' : 's'} to ${target.email}`);
        }
        await deleteUser(user.email);
        console.log(`Deleted ${user.email}`);
    },
};

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            email: { type: 'string' },
            password: { type: 'string' },
            role: { type: 'string' },
            'reassign-to': { type: 'string' },
            yes: { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
        },
    });

    const command = positionals[0];
    if (!command || !commands[command]) {
        console.error(USAGE);
        process.exitCode = 1;
        return;
    }
    await db.migrate.latest();
    await commands[command](values);
}

main()
    .catch((err) => {
        console.error(err.message);
        process.exitCode = 1;
    })
    .finally(() => db.destroy());
