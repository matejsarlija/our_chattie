import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import PrivacyPolicy from './components/PrivacyPolicy';
import AboutUs from './components/AboutUs';
import { DashboardPage, AnalysisRunDetailPage } from './components/Dashboard';
import { AnalysisLabPage, LabExperimentDetailPage } from './components/Dashboard/AnalysisLab';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/dashboard/runs/:id" element={<AnalysisRunDetailPage />} />
        <Route path="/dashboard/lab" element={<AnalysisLabPage />} />
        <Route path="/dashboard/lab/experiments/:id" element={<LabExperimentDetailPage />} />
        <Route path="/pravila-privatnosti" element={<PrivacyPolicy />} />
        <Route path="/o-nama" element={<AboutUs />} />
      </Routes>
    </Router>
  );
}

export default App;
