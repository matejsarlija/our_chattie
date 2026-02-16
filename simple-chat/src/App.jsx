import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import AltChat from './components/AltChat';
import PrivacyPolicy from './components/PrivacyPolicy';
import AboutUs from './components/AboutUs';
import AuthModal from './components/Auth/AuthModal';
import { DashboardPage, AnalysisRunDetailPage } from './components/Dashboard';
import { ChatProvider } from './contexts/ChatContext';
import { AuthProvider } from './contexts/AuthContext';

function App() {
  return (
    <AuthProvider>
      <ChatProvider>
        <Router>
          <Routes>
            <Route path="/" element={<AltChat />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/runs/:id" element={<AnalysisRunDetailPage />} />
            <Route path="/pravila-privatnosti" element={<PrivacyPolicy />} />
            <Route path="/o-nama" element={<AboutUs />} />
          </Routes>
          <AuthModal />
        </Router>
      </ChatProvider>
    </AuthProvider>
  );
}

export default App;
