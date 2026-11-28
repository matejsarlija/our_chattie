import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import PrivacyPolicy from './components/PrivacyPolicy';
import AboutUs from './components/AboutUs';
import DashboardPage from './components/Dashboard/DashboardPage';

const AnalysisRunDetailPage = lazy(() => import('./components/Dashboard/AnalysisRunDetailPage'));
const BenchPage = lazy(() => import('./components/Bench/BenchPage'));
const BenchRunDetailPage = lazy(() => import('./components/Bench/BenchRunDetailPage'));
const BenchGoldEditorPage = lazy(() => import('./components/Bench/BenchGoldEditorPage'));
const DesignSystemPage = lazy(() => import('./components/DesignSystem/DesignSystemPage'));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4" role="status" aria-label="Učitavanje sučelja">
      <div className="rounded-lg border border-line bg-surface px-6 py-4 text-sm text-ink-muted">
        Učitavanje…
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route
          path="/dashboard/runs/:id"
          element={(
            <Suspense fallback={<RouteFallback />}>
              <AnalysisRunDetailPage />
            </Suspense>
          )}
        />
        <Route
          path="/dashboard/bench"
          element={(
            <Suspense fallback={<RouteFallback />}>
              <BenchPage />
            </Suspense>
          )}
        />
        <Route
          path="/dashboard/bench/runs/:runId"
          element={(
            <Suspense fallback={<RouteFallback />}>
              <BenchRunDetailPage />
            </Suspense>
          )}
        />
        <Route
          path="/dashboard/bench/gold"
          element={(
            <Suspense fallback={<RouteFallback />}>
              <BenchGoldEditorPage />
            </Suspense>
          )}
        />
        <Route
          path="/dashboard/design-system"
          element={(
            <Suspense fallback={<RouteFallback />}>
              <DesignSystemPage />
            </Suspense>
          )}
        />
        <Route path="/pravila-privatnosti" element={<PrivacyPolicy />} />
        <Route path="/o-nama" element={<AboutUs />} />
      </Routes>
    </Router>
  );
}

export default App;
