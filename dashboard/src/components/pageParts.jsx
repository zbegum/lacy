// Pieces shared by the tour and learner pages (see TourDetailPage.css).
import React from 'react';
import { Link } from 'react-router-dom';
import logo from '../assets/lacy_logo.png';

// Seconds as something a person reads: "45 s", "12 min", "1 h 20 min".
export function formatDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return '—';
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function formatDate(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const STATUS_LABEL = {
  completed: 'Completed', in_progress: 'In progress', assigned: 'Not started', not_started: 'Not started',
};

export function Status({ value }) {
  return <span className={`td-status ${value}`}>{STATUS_LABEL[value] || value}</span>;
}

export function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <a className="navbar-brand" href="/">
          <img src={logo} alt="Logo" className="navbar-logo" />
          <span className="navbar-title">LACY</span>
        </a>
        <div className="navbar-buttons">
          <Link to="/" className="navbar-link">Codebase Learners</Link>
          <Link to="/statistics" className="navbar-link">Tour Statistics</Link>
          <Link to="/my-tours" className="navbar-link">My Tours</Link>
        </div>
      </div>
    </nav>
  );
}

export function Stars({ value }) {
  const filled = Math.round(value || 0);
  return (
    <span className="td-stars" aria-label={`${filled} of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < filled ? 'on' : ''}>★</span>
      ))}
    </span>
  );
}

export function Stat({ label, value, detail }) {
  return (
    <div className="td-stat">
      <p className="td-stat-label">{label}</p>
      <p className="td-stat-value">{value}</p>
      {detail && <p className="td-stat-detail">{detail}</p>}
    </div>
  );
}

/** Navbar plus the page column, with a message in place of content. */
export function PageMessage({ children }) {
  return (
    <div className="td-page">
      <Navbar />
      <main className="td-main"><p className="td-muted">{children}</p></main>
    </div>
  );
}
