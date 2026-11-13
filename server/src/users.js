// User accounts. Passwords are stored as bcrypt hashes.
const bcrypt = require('bcryptjs');
const { db, insertAndGetId } = require('./db');

const ROLES = ['expert', 'learner'];

function publicUser(row) {
    if (!row) return null;
    const { password_hash: _hash, ...user } = row;
    return user;
}

/**
 * Departments are free text chosen by each team. Matching ignores case, and a new
 * account joins an existing department under the spelling already in use, so
 * "backend" and "Backend" never end up as two separate groups.
 */
async function canonicalDepartment(department) {
    const value = department === null || department === undefined ? null : String(department).trim();
    if (!value) return null;
    const existing = await db('users')
        .whereRaw('LOWER(department) = ?', [value.toLowerCase()])
        .first('department');
    return existing ? existing.department : value;
}

async function listDepartments() {
    const rows = await db('users')
        .whereNotNull('department')
        .groupBy('department')
        .select('department')
        .count({ members: '*' })
        .orderBy('department');
    return rows
        .filter((r) => String(r.department).trim() !== '')
        .map((r) => ({ department: r.department, members: Number(r.members) }));
}

async function createUser({ email, password, role = 'learner', department = null, name = null }) {
    if (!email || !password) throw new Error('email and password are required');
    if (!ROLES.includes(role)) throw new Error(`role must be one of: ${ROLES.join(', ')}`);

    department = await canonicalDepartment(department);
    const id = await insertAndGetId('users', {
        email: email.trim().toLowerCase(),
        password_hash: await bcrypt.hash(password, 12),
        role,
        department,
        name,
    });
    return publicUser(await db('users').where({ id }).first());
}

async function verifyCredentials(email, password) {
    const row = await db('users').where({ email: String(email).trim().toLowerCase() }).first();
    if (!row || !(await bcrypt.compare(String(password), row.password_hash))) {
        return null;
    }
    return publicUser(row);
}

const MIN_PASSWORD_LENGTH = 8;

async function setPassword(userId, newPassword) {
    if (!newPassword || String(newPassword).length < MIN_PASSWORD_LENGTH) {
        throw new Error(`the new password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const updated = await db('users')
        .where({ id: userId })
        .update({ password_hash: await bcrypt.hash(String(newPassword), 12) });
    return updated > 0;
}

/** Change a password after checking the current one. */
async function changePassword(userId, currentPassword, newPassword) {
    const row = await db('users').where({ id: userId }).first();
    if (!row || !(await bcrypt.compare(String(currentPassword), row.password_hash))) {
        return false;
    }
    return setPassword(userId, newPassword);
}

async function listUsers() {
    return db('users').orderBy('id').select('id', 'email', 'name', 'department', 'role', 'created_at');
}

async function findByEmail(email) {
    const row = await db('users').where({ email: String(email).trim().toLowerCase() }).first();
    return publicUser(row);
}

/** How many tours this person wrote. Deleting them would take these with them. */
async function countToursOwned(userId) {
    const { total } = await db('tour').where({ user_id: userId }).count({ total: '*' }).first();
    return Number(total);
}

/** Hand someone's tours to another account, so they survive the person leaving. */
async function reassignTours(fromUserId, toUserId) {
    return db('tour').where({ user_id: fromUserId }).update({ user_id: toUserId });
}

/** Delete an account. Any tours still owned by it go too, so reassign them first. */
async function deleteUser(email) {
    return db('users').where({ email: String(email).trim().toLowerCase() }).del();
}

module.exports = {
    ROLES, MIN_PASSWORD_LENGTH, createUser, verifyCredentials, publicUser,
    setPassword, changePassword, listUsers, findByEmail, deleteUser,
    canonicalDepartment, listDepartments, countToursOwned, reassignTours,
};
