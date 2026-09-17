import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SettingsModal from './SettingsModal';

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function DashboardHeader({ onOpenNewAnalysis }) {
  const navigate = useNavigate();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleNewAnalysis = () => {
    if (onOpenNewAnalysis) {
      onOpenNewAnalysis();
      return;
    }
    navigate('/dashboard?new=1');
  };

  return (
    <>
      <div className="border-b border-[var(--border)] bg-[var(--surface)]/95 p-4 backdrop-blur">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-[var(--text)] text-xl font-semibold tracking-tight">
              <Link to="/dashboard">
                Pravni Asistent
              </Link>
            </h1>
          </div>

          <div className="hidden lg:flex items-center gap-6">
            <Link to="/dashboard" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              Dashboard
            </Link>
            <button
              type="button"
              onClick={handleNewAnalysis}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:opacity-90"
            >
              + Nova analiza
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Postavke"
              className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <GearIcon />
            </button>

            <Link to="/pravila-privatnosti" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              Pravila privatnosti
            </Link>
            <Link to="/o-nama" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              O nama
            </Link>
          </div>

          <div className="lg:hidden ml-auto flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Postavke"
              className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <GearIcon />
            </button>
            <button
              type="button"
              onClick={handleNewAnalysis}
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white hover:opacity-90"
            >
              + Nova analiza
            </button>
          </div>
        </div>
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
