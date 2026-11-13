// The table on the dashboard's list pages: click a header to sort, click a row to
// open it, paged when long. Styles are in TourDetailPage.css (.td-list-table).
import React, { useMemo, useState } from 'react';

/**
 * columns: [{ key, label, value: row => sortable value, render?: row => node, num? }]
 * rows: already filtered; this only sorts and pages them.
 */
export default function SortableTable({
  columns, rows, rowKey, onRowClick, defaultSort, pageSize = 25, empty, label,
}) {
  const [sort, setSort] = useState(defaultSort || { key: columns[0].key, asc: true });
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) || columns[0];
    const get = col.value || ((r) => r[col.key]);
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      const cmp = typeof va === 'string' || typeof vb === 'string'
        ? String(va ?? '').localeCompare(String(vb ?? ''), undefined, { sensitivity: 'base' })
        : (va ?? -Infinity) - (vb ?? -Infinity);
      return sort.asc ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const paged = sorted.slice((current - 1) * pageSize, current * pageSize);

  const toggle = (key) => {
    setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }));
    setPage(1);
  };

  if (rows.length === 0) return <p className="td-muted td-pad">{empty}</p>;

  return (
    <>
      <table className="td-table td-list-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.num ? 'num' : undefined}
                aria-sort={sort.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              >
                <button type="button" className="td-sort" onClick={() => toggle(c.key)}>
                  {c.label}
                  <span className="td-sort-mark" aria-hidden="true">
                    {sort.key === c.key ? (sort.asc ? '↑' : '↓') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paged.map((row) => (
            <tr
              key={rowKey(row)}
              className={onRowClick ? 'td-row-link' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={[c.num && 'num', c.cellClass].filter(Boolean).join(' ') || undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {totalPages > 1 && (
        <nav className="td-pagination" aria-label="Pages">
          <button type="button" onClick={() => setPage(current - 1)} disabled={current === 1}>Previous</button>
          <span>Page {current} of {totalPages}</span>
          <button type="button" onClick={() => setPage(current + 1)} disabled={current === totalPages}>Next</button>
        </nav>
      )}
    </>
  );
}

/** Completion as a thin bar and a percentage; "—" when there is nothing to complete. */
export function ProgressCell({ done, total }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="td-progress" title={total > 0 ? `${done} of ${total}` : 'Not assigned yet'}>
      <div className="td-progress-track"><div className="td-progress-fill" style={{ width: `${pct}%` }} /></div>
      <span>{total > 0 ? `${pct}%` : '—'}</span>
    </div>
  );
}
