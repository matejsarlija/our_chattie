import React from 'react';
import {BrowserRouter as Router, Routes, Route} from 'react-router-dom';
import AltChat from './components/AltChat';
import PrivacyPolicy from './components/PrivacyPolicy';
import AboutUs from './components/AboutUs';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AltChat />} />
        <Route path="/pravila-privatnosti" element={<PrivacyPolicy />} />
        <Route path="/o-nama" element={<AboutUs />} />
      </Routes>
    </Router>
  );
}

export default App;