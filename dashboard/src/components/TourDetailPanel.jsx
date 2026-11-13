import './TourDetailPage.css';
import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../api';
import { Navbar, Stars, Stat, Status, PageMessage, formatDuration, formatDate } from './pageParts';

const CODE_STATUS = {
  changed: { label: 'Code edited', title: 'A reader found this code edited since the tour was written', tone: 'warn' },
  missing: { label: 'Code gone', title: 'A reader could not find this code any more', tone: 'danger' },
  moved: { label: 'Code moved', title: 'A reader found this code at a different position', tone: 'muted' },
};

export default function TourDetailPanel() {
  const { id } = useParams();
  const [tour, setTour] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [answered, setAnswered] = useState({});
  const [answerError, setAnswerError] = useState({});
  const [sending, setSending] = useState({});

  useEffect(() => {
    apiFetch(`/api/dashboard/tour-full-detail?tour_id=${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const done = {};
        Object.values(data.questions_by_step || {}).flat().forEach((q) => {
          if (q.answer) done[q.question_id] = q.answer;
        });
        setAnswered(done);
        setTour(data);
      })
      .catch(() => setTour({ error: true }));
  }, [id]);

  if (!tour) return <PageMessage>Loading tour…</PageMessage>;
  if (tour.error || !tour.tour_details) {
    return (
      <PageMessage>
        This tour could not be loaded. It may have been deleted, or your session may have expired.
        Reopen the dashboard from VS Code.
      </PageMessage>
    );
  }

  const info = tour.tour_details;
  const users = tour.assigned_users || [];
  const steps = tour.tour_steps || [];
  const questionsByStep = tour.questions_by_step || {};
  const totalQuestions = Object.values(questionsByStep).flat().length;
  const openQuestions = Object.values(questionsByStep).flat().filter((q) => !answered[q.question_id]).length;

  const totalLearners = Number(tour.tour_statistics?.total_learners || 0);
  const completedLearners = Number(tour.tour_statistics?.completed_learners || 0);
  const completion = totalLearners > 0 ? Math.round((completedLearners / totalLearners) * 100) : null;

  const hasQuiz = tour.quiz_question_count == null ? true : tour.quiz_question_count > 0;
  const quizAttempts = tour.quiz_attempts ?? null;
  const quizValue = !hasQuiz ? 'No quiz'
    : quizAttempts === 0 ? '—'
      : `${Math.round(parseFloat(tour.quiz_success || 0))}%`;
  const quizDetail = !hasQuiz ? null
    : quizAttempts === 0 ? 'Nobody has taken it yet'
      : quizAttempts != null ? `Average of ${quizAttempts} attempt${quizAttempts === 1 ? '' : 's'}` : null;

  const ratingCount = tour.rating_count ?? (tour.feedbacks || []).filter((f) => f.rating).length;
  const comments = (tour.feedbacks || []).filter((fb) => fb.feedback && fb.feedback.trim() !== '');
  const created = formatDate(info.created_at);

  const reviewIds = new Set((tour.steps_needing_review || []).map((s) => s.step_number));

  const handleAnswerSubmit = async (questionId) => {
    const answer = (drafts[questionId] || '').trim();
    if (!answer) return;
    setSending((p) => ({ ...p, [questionId]: true }));
    setAnswerError((p) => ({ ...p, [questionId]: null }));
    try {
      const res = await apiFetch('/api/dashboard/answer-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: questionId, answer }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        setAnswered((p) => ({ ...p, [questionId]: answer }));
      } else {
        setAnswerError((p) => ({ ...p, [questionId]: body.error || 'The answer could not be saved. Please try again.' }));
      }
    } catch {
      setAnswerError((p) => ({ ...p, [questionId]: 'The answer could not be saved. Please try again.' }));
    } finally {
      setSending((p) => ({ ...p, [questionId]: false }));
    }
  };

  return (
    <div className="td-page">
      <Navbar />

      <main className="td-main">
        <nav className="td-breadcrumb" aria-label="Breadcrumb">
          <Link to="/statistics">Tour Statistics</Link>
          <span aria-hidden="true">/</span>
          <span>{info.tour_name}</span>
        </nav>

        <header className="td-header">
          <h1 className="td-title">{info.tour_name}</h1>
          <p className="td-meta">
            <span>{info.project_name}</span>
            <span>{info.target_department || 'No department'}</span>
            <span>By {info.created_by || 'unknown'}</span>
            {created && <span>Created {created}</span>}
          </p>
        </header>

        <section className="td-stats" aria-label="Summary">
          <Stat
            label="Completed"
            value={completion == null ? '—' : `${completion}%`}
            detail={totalLearners > 0 ? `${completedLearners} of ${totalLearners} learner${totalLearners === 1 ? '' : 's'}` : 'Not assigned to anyone yet'}
          />
          <Stat
            label="Average time"
            value={formatDuration(tour.time_statistics?.avg_time_spent)}
            detail="Per learner who started"
          />
          <Stat label="Quiz average" value={quizValue} detail={quizDetail} />
          <Stat
            label="Rating"
            value={ratingCount > 0 ? <><Stars value={parseFloat(tour.tour_rating)} /> <span className="td-stat-num">{parseFloat(tour.tour_rating).toFixed(1)}</span></> : '—'}
            detail={ratingCount > 0 ? `${ratingCount} rating${ratingCount === 1 ? '' : 's'}` : 'No ratings yet'}
          />
        </section>

        <div className="td-grid">
          <section className="td-card td-steps">
            <div className="td-card-head">
              <h2>Steps</h2>
              <span className="td-muted">
                {steps.length} step{steps.length === 1 ? '' : 's'}
                {totalQuestions > 0 && ` · ${totalQuestions} question${totalQuestions === 1 ? '' : 's'}`}
                {openQuestions > 0 && <span className="td-pill warn">{openQuestions} unanswered</span>}
              </span>
            </div>

            {reviewIds.size > 0 && (
              <p className="td-notice">
                {reviewIds.size} step{reviewIds.size === 1 ? ' no longer matches' : 's no longer match'} the code
                learners see. Rewrite {reviewIds.size === 1 ? 'it' : 'them'}, or regenerate the tour.
              </p>
            )}

            <ol className="td-step-list">
              {steps.map((step) => {
                const qs = questionsByStep[step.step_number] || [];
                const status = CODE_STATUS[step.code_status];
                return (
                  <li key={step.id ?? step.step_number} className="td-step">
                    <div className="td-step-num">{step.step_number}</div>
                    <div className="td-step-body">
                      <div className="td-step-top">
                        {step.file_path && (
                          <code className="td-file">
                            {step.file_path}
                            {step.line_start != null && `:${step.line_start + 1}–${step.line_end + 1}`}
                          </code>
                        )}
                        {status && <span className={`td-pill ${status.tone}`} title={status.title}>{status.label}</span>}
                      </div>
                      <p className="td-step-text">{step.description}</p>

                      {qs.length > 0 && (
                        <ul className="td-questions">
                          {qs.map((q) => (
                            <li key={q.question_id} className="td-question">
                              <p className="td-q-text">{q.question}</p>
                              {q.learner_email && <p className="td-q-from">Asked by {q.learner_email}</p>}
                              {answered[q.question_id] ? (
                                <p className="td-q-answer"><span>Your answer</span>{answered[q.question_id]}</p>
                              ) : tour.is_expert ? (
                                <form
                                  className="td-answer-form"
                                  onSubmit={(e) => { e.preventDefault(); handleAnswerSubmit(q.question_id); }}
                                >
                                  <input
                                    type="text"
                                    placeholder="Write an answer"
                                    aria-label={`Answer to: ${q.question}`}
                                    value={drafts[q.question_id] || ''}
                                    onChange={(e) => setDrafts((p) => ({ ...p, [q.question_id]: e.target.value }))}
                                  />
                                  <button type="submit" disabled={!(drafts[q.question_id] || '').trim() || sending[q.question_id]}>
                                    {sending[q.question_id] ? 'Sending…' : 'Answer'}
                                  </button>
                                  {answerError[q.question_id] && <p className="td-error">{answerError[q.question_id]}</p>}
                                </form>
                              ) : (
                                <p className="td-muted">Waiting for an answer</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <aside className="td-side">
            <section className="td-card">
              <div className="td-card-head">
                <h2>Learners</h2>
                <span className="td-muted">{users.length}</span>
              </div>
              {users.length === 0 ? (
                <p className="td-muted">Nobody in {info.target_department || 'this department'} has this tour yet.</p>
              ) : (
                <table className="td-table">
                  <thead>
                    <tr><th>Learner</th><th>Status</th><th className="num">Time</th><th className="num">Score</th></tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id ?? u.email}>
                        <td className="td-ellipsis" title={u.email}>
                          {u.id != null ? <Link to={`/learner/${u.id}`}>{u.name || u.email}</Link> : (u.name || u.email)}
                        </td>
                        <td><Status value={u.tour_status} /></td>
                        <td className="num">{formatDuration(u.time_spent)}</td>
                        <td className="num">{u.score == null ? '—' : `${Math.round(parseFloat(u.score))}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="td-card">
              <div className="td-card-head">
                <h2>Feedback</h2>
                <span className="td-muted">{comments.length}</span>
              </div>
              {comments.length === 0 ? (
                <p className="td-muted">No written feedback yet.</p>
              ) : (
                <ul className="td-feedback">
                  {comments.map((fb, i) => (
                    <li key={i}>
                      <p className="td-feedback-text">{fb.feedback}</p>
                      <p className="td-feedback-from">
                        {fb.learner_email || 'Anonymous'}
                        {fb.rating ? <> · <Stars value={fb.rating} /></> : null}
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
