import { useEffect, useState } from 'react';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useCourtAnalysisStream } from '../../hooks/useCourtAnalysisStream';
import ScanDepthSelect from './ScanDepthSelect';

const oibSchema = z
  .string()
  .trim()
  .regex(/^\d{11}$/, 'OIB mora sadržavati točno 11 znamenki.');

export default function NewAnalysisModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const streamingAPI = useCourtAnalysisStream();

  const [oib, setOib] = useState('');
  const [scanDepth, setScanDepth] = useState('balanced');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const validated = oibSchema.safeParse(oib);
    if (!validated.success) {
      setError(validated.error.issues[0]?.message || 'Neispravan OIB.');
      return;
    }

    let initialAnalysisId = null;
    let streamError = null;

    try {
      await streamingAPI.streamCourtAnalysis(validated.data, {
        onMessage: (message) => {
          if (message?.analysisId && !initialAnalysisId) {
            initialAnalysisId = message.analysisId;
            onClose();
            navigate(`/dashboard/runs/${message.analysisId}`);
          }
        },
        onError: (message, err) => {
          streamError = message || 'Neuspjelo pokretanje analize.';
        },
        onComplete: () => {},
      }, { scanDepth });

      if (streamError) {
        setError(streamError);
        return;
      }

      if (!initialAnalysisId) {
        setError('Analiza je pokrenuta, ali identifikator nije vraćen. Pokušajte ponovno.');
      }
    } catch (err) {
      setError(err.message || 'Neuspjelo pokretanje analize.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[115] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-analysis-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="new-analysis-title" className="text-xl font-semibold text-[var(--text)]">Nova analiza</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Unesite OIB za pokretanje nove analize i praćenje kroz dashboard.</p>

        <form className="mt-4 space-y-3" onSubmit={handleSubmit}>
          <label className="block text-sm text-[var(--text-muted)]">
            OIB
            <input
              value={oib}
              onChange={(e) => setOib(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              placeholder="npr. 12345678901"
              autoFocus
            />
          </label>

          <div className="border-t border-[var(--border)] pt-4">
            <ScanDepthSelect value={scanDepth} onChange={setScanDepth} disabled={streamingAPI.isLoading} />
          </div>

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
              disabled={streamingAPI.isLoading}
            >
              Odustani
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white hover:opacity-90 disabled:opacity-60"
              disabled={streamingAPI.isLoading}
            >
              {streamingAPI.isLoading ? 'Pokrećem…' : 'Pokreni'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
