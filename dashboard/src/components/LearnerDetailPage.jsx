import './TourDetailPage.css';
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { Navbar, Stars, Stat, Status, PageMessage, formatDuration, plural } from './pageParts';

/** One learner (/learner/:id): their guided tours, scores, feedback and questions. */
export default function LearnerDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    apiFetch(`/api/dashboard/learner-profile?user_id=${encodeURIComponent(id)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch(() => setData({ error: true }));
  }, [id]);

  if (!data) return <PageMessage>Loading learner…</PageMessage>;
  if (data.error || !data.profile) {
    return (
      <PageMessage>
        This learner could not be loaded. The account may have been removed, or your session may
        have expired. Reopen the dashboard from VS Code.
      </PageMessage>
    );
  }

  const profile = data.profile;
  const tours = data.tours || [];
  const questions = data.questions || [];
  const total = Number(profile.total_tours || 0);
  const completed = Number(profile.completed_tours || 0);
  const completion = total > 0 ? Math.round((completed / total) * 100) : null;

  const scores = tours.map((t) => t.average_score).filter((s) => s != null && !Number.isNaN(Number(s)));
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + Number(b), 0) / scores.length) : null;
  const feedback = tours.filter((t) => (t.feedback && t.feedback.trim()) || t.rating);
  const unanswered = questions.filter((q) => !q.answer).length;

  return (
    <div className="td-page">
      <Navbar />

      <main className="td-main">
        <nav className="td-breadcrumb" aria-label="Breadcrumb">
          <Link to="/">Codebase Learners</Link>
          <span aria-hidden="true">/</span>
          <span>{profile.name || profile.username}</span>
        </nav>

        <header className="td-header">
          <h1 className="td-title">{profile.name || profile.username}</h1>
          <p className="td-meta">
            {profile.name && <span>{profile.username}</span>}
            <span>{profile.team || 'No department'}</span>
            <span>Learner</span>
          </p>
        </header>

        <section className="td-stats" aria-label="Summary">
          <Stat
            label="Completed"
            value={completion == null ? '—' : `${completion}%`}
            detail={total > 0 ? `${completed} of ${plural(total, 'guided tour')}` : 'No guided tours yet'}
          />
          <Stat label="Time spent" value={formatDuration(profile.total_time_spent)} detail="Across all guided tours" />
          <Stat
            label="Quiz average"
            value={avgScore == null ? '—' : `${avgScore}%`}
            detail={scores.length ? `Over ${plural(scores.length, 'quiz')}`.replace('quizs', 'quizzes') : 'No quiz taken yet'}
          />
          <Stat
            label="Questions asked"
            value={questions.length}
            detail={questions.length ? (unanswered ? `${unanswered} waiting for an answer` : 'All answered') : 'None yet'}
          />
        </section>

        <div className="td-grid">
          <section className="td-card">
            <div className="td-card-head">
              <h2>Guided tours</h2>
              <span className="td-muted">{tours.length}</span>
            </div>
            {tours.length === 0 ? (
              <p className="td-muted">Nothing has been assigned to {profile.team || 'this learner'} yet.</p>
            ) : (
              <table className="td-table td-table-wide">
                <thead>
                  <tr><th>Tour</th><th>Status</th><th className="num">Time</th><th className="num">Quiz</th></tr>
                </thead>
                <tbody>
                  {tours.map((t) => (
                    <tr key={t.tour_id}>
                      <td className="td-ellipsis">
                        <Link to={`/tour/${t.tour_id}`} title={t.tour_name}>{t.tour_name}</Link>
                        {t.project_name && <span className="td-cell-sub">{t.project_name}</span>}
                      </td>
                      <td><Status value={t.tour_status} /></td>
                      <td className="num">{formatDuration(t.time_spent)}</td>
                      <td className="num">
                        {t.quiz_question_count === 0 ? <span className="td-muted">No quiz</span>
                          : t.average_score == null ? '—' : `${Math.round(t.average_score)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <aside className="td-side">
            <section className="td-card">
              <div className="td-card-head">
                <h2>Questions</h2>
                <span className="td-muted">{questions.length}</span>
              </div>
              {questions.length === 0 ? (
                <p className="td-muted">No questions asked yet.</p>
              ) : (
                <ul className="td-questions td-questions-flat">
                  {questions.map((q) => (
                    <li key={q.question_id} className="td-question">
                      <p className="td-q-text">{q.question}</p>
                      <p className="td-q-from">
                        <Link to={`/tour/${q.tour_id}`}>{q.tour_name}</Link>, step {q.step_no}
                      </p>
                      {q.answer
                        ? <p className="td-q-answer"><span>Answer</span>{q.answer}</p>
                        : <p className="td-muted td-q-pending">Not answered yet</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="td-card">
              <div className="td-card-head">
                <h2>Feedback given</h2>
                <span className="td-muted">{feedback.length}</span>
              </div>
              {feedback.length === 0 ? (
                <p className="td-muted">No feedback yet.</p>
              ) : (
                <ul className="td-feedback">
                  {feedback.map((t) => (
                    <li key={t.tour_id}>
                      {t.feedback && t.feedback.trim() && <p className="td-feedback-text">{t.feedback}</p>}
                      <p className="td-feedback-from">
                        <Link to={`/tour/${t.tour_id}`}>{t.tour_name}</Link>
                        {t.rating ? <> · <Stars value={t.rating} /></> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
