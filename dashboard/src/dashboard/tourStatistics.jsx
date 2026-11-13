import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import './dashboard.css';
import '../components/TourDetailPage.css';
import { apiFetch } from '../api';
import { Navbar, Stat, formatDate, plural } from '../components/pageParts';
import SortableTable, { ProgressCell } from '../components/SortableTable';

// Categorical hues in fixed order (validated on the card surface, dark mode).
// Beyond seven groups the rest fold into "Other" rather than inventing hues.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767'];
const OTHER = '#6b6b80';
const STATUS = { Completed: '#10b981', 'Not completed': '#6b6b80' };

function ChartTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="td-tooltip">
      <span className="td-swatch" style={{ background: p.fill }} />
      <strong>{p.name}</strong>
      <span>{plural(p.value, 'tour')} · {total ? Math.round((p.value / total) * 100) : 0}%</span>
    </div>
  );
}

/** A donut with its total in the middle and a legend that names every slice. */
function Donut({ title, items, colors, empty }) {
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  let slices = sorted;
  if (!colors && sorted.length > SERIES.length) {
    const rest = sorted.slice(SERIES.length - 1);
    slices = [...sorted.slice(0, SERIES.length - 1), { name: `Other (${rest.length})`, value: rest.reduce((n, i) => n + i.value, 0), other: true }];
  }
  slices = slices.map((s, i) => ({ ...s, fill: colors ? (colors[s.name] || OTHER) : s.other ? OTHER : SERIES[i] }));
  const total = slices.reduce((n, s) => n + s.value, 0);
  const [hover, setHover] = useState(null);

  return (
    <section className="td-card td-chart-card">
      <div className="td-card-head"><h2>{title}</h2></div>
      {total === 0 ? <p className="td-muted">{empty}</p> : (
        <div className="td-donut-row">
          <div className="td-donut">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices} dataKey="value" nameKey="name"
                  innerRadius="68%" outerRadius="100%" paddingAngle={slices.length > 1 ? 2 : 0}
                  stroke={slices.length > 1 ? "#2a2a40" : "none"} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}
                  onMouseEnter={(_, i) => setHover(i)} onMouseLeave={() => setHover(null)}
                >
                  {slices.map((s, i) => (
                    <Cell key={s.name} fill={s.fill} opacity={hover == null || hover === i ? 1 : 0.45} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip total={total} />} cursor={false} />
              </PieChart>
            </ResponsiveContainer>
            <div className="td-donut-center" aria-hidden="true">
              <span className="td-donut-total">{total}</span>
              <span className="td-donut-unit">{total === 1 ? 'tour' : 'tours'}</span>
            </div>
          </div>
          <ul className="td-legend">
            {slices.map((s, i) => (
              <li
                key={s.name}
                className={hover != null && hover !== i ? 'dim' : undefined}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
              >
                <span className="td-swatch" style={{ background: s.fill }} />
                <span className="td-legend-name td-ellipsis" title={s.name}>{s.name}</span>
                <span className="td-legend-value">{s.value}</span>
                <span className="td-legend-pct">{Math.round((s.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const countBy = (list, key) => {
  const counts = {};
  for (const t of list) {
    const k = t[key] || 'None';
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
};

const COLUMNS = [
  { key: 'tour_name', label: 'Tour', value: (t) => t.tour_name || '', cellClass: 'td-ellipsis td-strong' },
  { key: 'project_name', label: 'Project', value: (t) => t.project_name || '', render: (t) => t.project_name || '—', cellClass: 'td-ellipsis' },
  { key: 'target_department', label: 'Department', value: (t) => t.target_department || '', render: (t) => t.target_department || <span className="td-muted">None</span>, cellClass: 'td-ellipsis' },
  { key: 'created_by', label: 'Expert', value: (t) => t.created_by || '', cellClass: 'td-ellipsis' },
  { key: 'completion', label: 'Completed', value: (t) => (t.learners > 0 ? t.completed_learners / t.learners : -1),
    render: (t) => <ProgressCell done={t.completed_learners || 0} total={t.learners || 0} /> },
  { key: 'created_at', label: 'Created', value: (t) => new Date(String(t.created_at || '').replace(' ', 'T')).getTime() || 0,
    render: (t) => formatDate(t.created_at) || '—', num: true },
];

export default function TourStatistics() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    apiFetch('/api/dashboard/all-tour-statistics')
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(() => setData({ error: true }));
  }, []);

  const tours = useMemo(() => (Array.isArray(data?.part_2) ? data.part_2 : []), [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tours.filter((t) => !q
      || (t.tour_name || '').toLowerCase().includes(q)
      || (t.project_name || '').toLowerCase().includes(q)
      || (t.target_department || '').toLowerCase().includes(q)
      || (t.created_by || '').toLowerCase().includes(q));
  }, [tours, query]);

  const byDept = countBy(tours, 'target_department');
  const byProject = (data?.part_1?.projects || []).map((p) => ({ name: p.project_name || 'None', value: Number(p.total_tours_per_project) || 0 }));
  const byExpert = (data?.part_1?.experts || []).map((e) => ({ name: e.expert_name || 'Unknown', value: Number(e.total_tours_for_expert) || 0 }));
  const done = data?.part_1?.completed || {};
  const assigned = tours.filter((t) => t.learners > 0).length;

  return (
    <div className="td-page">
      <Navbar />
      <main className="td-main">
        {data?.error ? (
          <p className="td-muted">Tour statistics could not be loaded. Reopen the dashboard from VS Code.</p>
        ) : (
          <>
            <header className="td-header">
              <h1 className="td-title">Tour Statistics</h1>
              <p className="td-meta"><span>Every guided tour on this server</span></p>
            </header>

            <section className="td-stats" aria-label="Summary">
              <Stat label="Guided tours" value={data ? tours.length : '—'} detail={data ? `${assigned} assigned to learners` : null} />
              <Stat
                label="Finished by everyone"
                value={data ? (done.total_tours > 0 ? `${Math.round(((done.completed_tours || 0) / done.total_tours) * 100)}%` : '—') : '—'}
                detail={data ? `${done.completed_tours || 0} of ${plural(done.total_tours || 0, 'tour')}` : null}
              />
              <Stat label="Projects" value={data ? byProject.length : '—'} />
              <Stat label="Experts" value={data ? byExpert.length : '—'} />
            </section>

            <div className="td-charts-grid">
              <Donut title="Tours by department" items={byDept} empty="No tours yet." />
              <Donut title="Tours by project" items={byProject} empty="No tours yet." />
              <Donut title="Tours by expert" items={byExpert} empty="No tours yet." />
              <Donut
                title="Tours by status"
                items={[
                  { name: 'Completed', value: Number(done.completed_tours) || 0 },
                  { name: 'Not completed', value: (Number(done.total_tours) || 0) - (Number(done.completed_tours) || 0) },
                ]}
                colors={STATUS}
                empty="No tours yet."
              />
            </div>

            <div className="td-section-head">
              <h2>All tours</h2>
              <input
                type="search" className="td-search" placeholder="Search tours, projects, departments"
                aria-label="Search tours" value={query} onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <section className="td-card td-card-flush">
              {data === null ? <p className="td-muted td-pad">Loading tours…</p> : (
                <SortableTable
                  label="All tours"
                  columns={COLUMNS}
                  rows={rows}
                  rowKey={(t) => t.id}
                  onRowClick={(t) => navigate(`/tour/${t.id}`)}
                  defaultSort={{ key: 'created_at', asc: false }}
                  empty={query ? 'No tour matches that search.' : 'No guided tours yet.'}
                />
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
