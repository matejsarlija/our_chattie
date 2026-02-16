import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

export default function AuthModal() {
  const { isAuthModalOpen, closeAuthModal, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('signin');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!isAuthModalOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        closeAuthModal();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isAuthModalOpen, closeAuthModal]);

  if (!isAuthModalOpen) return null;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Email i lozinka su obavezni.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const result = await signIn({
        email: email.trim(),
        password: password.trim(),
        mode,
      });

      if (result.mode === 'signup') {
        setNotice('Račun je kreiran. Ako je potrebna potvrda emaila, dovršite je i zatim se prijavite.');
      } else {
        closeAuthModal();
      }
    } catch (err) {
      setError(err.message || 'Prijava nije uspjela.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={closeAuthModal}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4">
          <h2 id="auth-modal-title" className="text-xl font-semibold text-[var(--text)]">Prijava</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Prijavite se za spremanje analiza i pregled povijesti.</p>
        </div>

        <div className="mb-4 inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-1 text-sm">
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 transition ${mode === 'signin' ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]'}`}
            onClick={() => setMode('signin')}
          >
            Prijava
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1.5 transition ${mode === 'signup' ? 'bg-[var(--surface)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]'}`}
            onClick={() => setMode('signup')}
          >
            Registracija
          </button>
        </div>

        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block text-sm text-[var(--text-muted)]">
            Email
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="block text-sm text-[var(--text-muted)]">
            Lozinka
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
          {notice && <p className="text-sm text-[var(--success)]">{notice}</p>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeAuthModal}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              disabled={loading}
            >
              Odustani
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-60"
              disabled={loading}
            >
              {loading ? 'Molimo pričekajte…' : mode === 'signin' ? 'Prijavi se' : 'Kreiraj račun'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
