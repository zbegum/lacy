// Small helpers shared by the route modules.

// Forward rejected promises from async handlers to the Express error handler.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// DATETIME literal in UTC. Stored as text, and sortable/comparable in SQL.
function toSqlDateTime(value) {
    if (value === undefined || value === null || value === '') return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().replace('T', ' ').replace('Z', '');
}

const now = () => toSqlDateTime(new Date());

// Aggregates can come back as null or text; normalise them to numbers.
function num(value) {
    if (value === null || value === undefined) return 0;
    const n = Number(value);
    return Number.isNaN(n) ? 0 : n;
}

function isTruthyFlag(value) {
    return value === true || value === 'true' || Number(value) === 1;
}

module.exports = { handle, toSqlDateTime, now, num, isTruthyFlag };
