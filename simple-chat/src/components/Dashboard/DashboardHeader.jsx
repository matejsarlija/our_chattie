import { Link, useNavigate } from 'react-router-dom';
import GeminiPlanToggle from './GeminiPlanToggle';

export default function DashboardHeader({ onOpenNewAnalysis }) {
  const navigate = useNavigate();

  const handleNewAnalysis = () => {
    if (onOpenNewAnalysis) {
      onOpenNewAnalysis();
      return;
    }
    navigate('/dashboard?new=1');
  };

  return (
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

          <GeminiPlanToggle />

          <Link to="/pravila-privatnosti" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            Pravila privatnosti
          </Link>
          <Link to="/o-nama" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            O nama
          </Link>
        </div>

        <div className="lg:hidden ml-auto flex items-center gap-3">
          <GeminiPlanToggle />
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
  );
}
