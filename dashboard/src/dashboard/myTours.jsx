import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './dashboard.css';
import '../components/TourDetailPage.css';
import { apiFetch } from '../api';
import { Navbar, Stars, Stat, formatDate, plural } from '../components/pageParts';
import SortableTable, { ProgressCell } from '../components/SortableTable';

const COLUMNS = [
  { key: 'tour_name', label: 'Tour', value: (t) => t.tour_name || '', cellClass: 'td-ellipsis td-strong' },
  { key: 'project_name', label: 'Project', value: (t) => t.project_name || '', render: (t) => t.project_name || '—', cellClass: 'td-ellipsis' },
  { key: 'completion_ratio', label: 'Completed', value: (t) => (t.learners > 0 ? Number(t.completion_ratio) : -1),
    render: (t) => (t.learners != null
      ? <ProgressCell done={t.completed_learners} total={t.learners} />
      : <ProgressCell done={Number(t.completion_ratio) || 0} total={100} />) },
  { key: 'average_rating', label: 'Rating', value: (t) => (t.rating_count === 0 ? null : Number(t.average_rating)),
    render: (t) => (t.rating_count === 0 || !Number(t.average_rating) ? <span className="td-muted">—</span> : <Stars value={t.average_rating} />) },
  { key: 'feedback_count', label: 'Feedback', value: (t) => Number(t.feedback_count) || 0, num: true },
  { key: 'created_at', label: 'Created', value: (t) => new Date(String(t.created_at || '').replace(' ', 'T')).getTime() || 0,
    render: (t) => formatDate(t.created_at) || '—', num: true },
];

export default function MyTours() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    // The server identifies the expert from the session token.
    apiFetch('/api/dashboard/expert-profile')
      .then((res) => {
        if (!res.ok) {
          throw new Error(res.status === 403 ? 'The dashboard is for expert accounts only.' : `Server returned ${res.status}`);
        }
        return res.json();
      })
      .then(setData)
      .catch((err) => setData({ error: err.message }));
  }, []);

  const tours = useMemo(() => (Array.isArray(data?.tours) ? data.tours : []), [data]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tours.filter((t) => !q
      || (t.tour_name || '').toLowerCase().includes(q)
      || (t.project_name || '').toLowerCase().includes(q));
  }, [tours, query]);

  const profile = data?.profile || {};
  const learners = tours.reduce((n, t) => n + (Number(t.learners) || 0), 0);
  const completed = tours.reduce((n, t) => n + (Number(t.completed_learners) || 0), 0);
  const feedback = tours.reduce((n, t) => n + (Number(t.feedback_count) || 0), 0);
  const rated = tours.filter((t) => Number(t.rating_count) > 0 && Number(t.average_rating) > 0);
  const avgRating = rated.length ? rated.reduce((n, t) => n + Number(t.average_rating), 0) / rated.length : null;

  return (
    <div className="td-page">
      <Navbar />
      <main className="td-main">
        {data?.error ? (
          <p className="td-muted">{data.error} Reopen the dashboard from the Lacy sidebar in VS Code.</p>
        ) : (
          <>
            <header className="td-header td-header-row">
              <div>
                <h1 className="td-title">My Tours</h1>
                <p className="td-meta">
                  {profile.name && <span>{profile.name}</span>}
                  {profile.email && <span>{profile.email}</span>}
                  {profile.department && <span>{profile.department}</span>}
                  <span>Guided tours you wrote</span>
                </p>
              </div>
              <input
                type="search" className="td-search" placeholder="Search by tour or project"
                aria-label="Search tours" value={query} onChange={(e) => setQuery(e.target.value)}
              />
            </header>

            <section className="td-stats" aria-label="Summary">
              <Stat label="Guided tours" value={data ? tours.length : '—'} />
              <Stat
                label="Learners finished"
                value={learners > 0 ? `${Math.round((completed / learners) * 100)}%` : '—'}
                detail={learners > 0 ? `${completed} of ${plural(learners, 'assignment')}` : 'Not assigned to anyone yet'}
              />
              <Stat
                label="Average rating"
                value={avgRating == null ? '—' : <><Stars value={avgRating} /> <span className="td-stat-num">{avgRating.toFixed(1)}</span></>}
                detail={avgRating == null ? 'No ratings yet' : `Over ${plural(rated.length, 'tour')}`}
              />
              <Stat label="Feedback" value={feedback} detail={feedback ? 'Comments and ratings' : 'None yet'} />
            </section>

            <section className="td-card td-card-flush">
              {data === null ? <p className="td-muted td-pad">Loading tours…</p> : (
                <SortableTable
                  label="My tours"
                  columns={COLUMNS}
                  rows={rows}
                  rowKey={(t) => t.tour_id}
                  onRowClick={(t) => navigate(`/tour/${t.tour_id}`)}
                  defaultSort={{ key: 'created_at', asc: false }}
                  empty={query ? 'No tour matches that search.' : 'You have not written a guided tour yet. Make one from the Lacy sidebar in VS Code.'}
                />
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
