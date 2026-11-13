import React, { useEffect, useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import CodebaseLearners from './dashboard/codebaseLearners';
import TourStatistics from './dashboard/tourStatistics';
import MyTours from './dashboard/myTours';
import TourDetailPageWrapper from './components/TourDetailPanel';
import LearnerDetailPage from './components/LearnerDetailPage';
import RecordAudio from './components/RecordAudio.jsx';
import { ensureSession } from './api';

function App() {
  // VS Code opens the dashboard with a single-use code; trade it for a session
  // before rendering anything that calls the API.
  const [session, setSession] = useState('checking');

  useEffect(() => {
    ensureSession().then((ok) => setSession(ok ? 'ready' : 'missing'));
  }, []);

  if (session === 'checking') {
    return <div style={{ padding: 24 }}>Signing in…</div>;
  }

  if (session === 'missing') {
    return (
      <div style={{ padding: 24, maxWidth: 520 }}>
        <h2>Your dashboard link has expired</h2>
        <p>Open the dashboard again from the Lacy sidebar in VS Code (“View Dashboard”).</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<CodebaseLearners />} />
      <Route path="/statistics" element={<TourStatistics />} />
      <Route path="/my-tours" element={<MyTours/>} />
      <Route path="/tour/:id" element={<TourDetailPageWrapper />} />
      <Route path="/learner/:id" element={<LearnerDetailPage />} />
      <Route path="record-audio/:stepId" element={<RecordAudio />} />
    </Routes>
  );
}

export default App;
