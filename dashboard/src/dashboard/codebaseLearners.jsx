import React, { useEffect, useMemo, useState } from 'react';
import './dashboard.css';
import '../components/TourDetailPage.css';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../api';
import { Navbar, formatDuration, plural } from '../components/pageParts';
import SortableTable, { ProgressCell } from '../components/SortableTable';

const ratio = (l) => (l.total_tours > 0 ? l.completed_tours / l.total_tours : -1);

const COLUMNS = [
  { key: 'name', label: 'Learner', value: (l) => l.name || l.username || '', render: (l) => l.name || l.username, cellClass: 'td-ellipsis td-strong' },
  { key: 'department', label: 'Department', value: (l) => l.department || '', render: (l) => l.department || <span className="td-muted">None</span>, cellClass: 'td-ellipsis' },
  { key: 'completion', label: 'Completed', value: ratio, render: (l) => <ProgressCell done={l.completed_tours} total={l.total_tours} /> },
  { key: 'total_tours', label: 'Tours', value: (l) => Number(l.total_tours) || 0, num: true },
  { key: 'total_time_spent', label: 'Time spent', value: (l) => Number(l.total_time_spent) || 0, render: (l) => formatDuration(l.total_time_spent), num: true },
  { key: 'average_score', label: 'Quiz average', value: (l) => (l.average_score == null ? null : Number(l.average_score)), render: (l) => (l.average_score == null ? '—' : `${Math.round(l.average_score)}%`), num: true },
];

export default function CodebaseLearners() {
  const navigate = useNavigate();
  const [learners, setLearners] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    apiFetch('/api/dashboard/codebase-learners')
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data) => setLearners(Array.isArray(data) ? data : data.learners || []))
      .catch(() => setLearners({ error: true }));
  }, []);

  const rows = useMemo(() => {
    if (!Array.isArray(learners)) return [];
    const q = query.trim().toLowerCase();
    return learners.filter((l) => !q
      || (l.name || l.username || '').toLowerCase().includes(q)
      || (l.department || '').toLowerCase().includes(q));
  }, [learners, query]);

  const count = Array.isArray(learners) ? learners.length : 0;

  return (
    <div className="td-page">
      <Navbar />
      <main className="td-main">
        <header className="td-header td-header-row">
          <div>
            <h1 className="td-title">Codebase Learners</h1>
            <p className="td-meta"><span>{plural(count, 'learner')}</span><span>Guided tours only</span></p>
          </div>
          <input
            type="search" className="td-search" placeholder="Search by name or department"
            aria-label="Search learners" value={query} onChange={(e) => setQuery(e.target.value)}
          />
        </header>

        <section className="td-card td-card-flush">
          {learners === null ? <p className="td-muted td-pad">Loading learners…</p>
            : learners.error ? <p className="td-muted td-pad">The learners could not be loaded. Reopen the dashboard from VS Code.</p>
              : (
                <SortableTable
                  label="Learners"
                  columns={COLUMNS}
                  rows={rows}
                  rowKey={(l) => l.id}
                  onRowClick={(l) => navigate(`/learner/${l.id}`)}
                  empty={query ? 'No learner matches that search.' : 'No learners yet. Accounts with the learner role show up here.'}
                />
              )}
        </section>
      </main>
    </div>
  );
}
