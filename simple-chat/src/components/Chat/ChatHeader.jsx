import { Link, useNavigate } from 'react-router-dom';
import MobileHeaderDropdown from '../MobileHeaderDropdown';
import { useChat } from '../../contexts/ChatContext';
import { useOptionalAuth } from '../../contexts/AuthContext';

export default function ChatHeader({ 
  mode = 'chat', 
  onModeToggle,
  onOpenNewAnalysis,
}) {
  const navigate = useNavigate();
  const { textSize, setTextSize } = useChat();
  const auth = useOptionalAuth();
  const isAuthed = Boolean(auth?.user);

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
            <Link to="/">
              Pravni Asistent
            </Link>
          </h1>

          {onModeToggle && (
            <button
              onClick={onModeToggle}
              className="px-3 py-1.5 text-sm border border-[var(--border)] bg-[var(--surface-muted)] hover:bg-[var(--surface)] rounded-md transition-colors flex items-center gap-2 text-[var(--text)]"
              title={mode === 'chat' ? 'Prebaci na Canvas' : 'Prebaci na Chat'}
            >
              {mode === 'chat' ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Canvas
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  Chat
                </>
              )}
            </button>
          )}
        </div>

        <div className="hidden lg:flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-[var(--text-muted)]">Tekst:</span>
            <button
              onClick={() => setTextSize(16)}
              className={`px-2 py-1 text-sm rounded border ${
                textSize === 16
                  ? 'bg-[var(--surface)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--surface-muted)] text-[var(--text)] border-[var(--border)]'
              } hover:bg-[var(--surface)]`}
            >
              A
            </button>
            <button
              onClick={() => setTextSize(18)}
              className={`px-2 py-1 text-sm rounded border ${
                textSize === 18
                  ? 'bg-[var(--surface)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--surface-muted)] text-[var(--text)] border-[var(--border)]'
              } hover:bg-[var(--surface)]`}
            >
              A+
            </button>
          </div>

          <div className="h-4 w-px bg-[var(--border)]"></div>

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

          {auth && (
            isAuthed ? (
              <button
                type="button"
                onClick={auth.signOut}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              >
                Odjava
              </button>
            ) : (
              <button
                type="button"
                onClick={auth.openAuthModal}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              >
                Prijava
              </button>
            )
          )}

          <Link to="/pravila-privatnosti" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            Pravila privatnosti
          </Link>
          <Link to="/o-nama" className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            O nama
          </Link>
        </div>

        <div className="lg:hidden ml-auto">
          <MobileHeaderDropdown onOpenNewAnalysis={handleNewAnalysis} />
        </div>
      </div>
    </div>
  );
}
