import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import PrivacyPolicy from './components/PrivacyPolicy';
import AboutUs from './components/AboutUs';
import { DashboardPage, AnalysisRunDetailPage } from './components/Dashboard';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/runs/:id" element={<AnalysisRunDetailPage />} />
        <Route path="/pravila-privatnosti" element={<PrivacyPolicy />} />
        <Route path="/o-nama" element={<AboutUs />} />
      </Routes>
    </Router>
  );
}

export default App;
