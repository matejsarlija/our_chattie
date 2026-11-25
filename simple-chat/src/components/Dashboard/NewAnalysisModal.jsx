import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useCourtAnalysisStream } from '../../hooks/useCourtAnalysisStream';
import { useSettings } from '../../hooks/useSettings';
import Dialog from '../ui/Dialog';
import ScanDepthSelect from './ScanDepthSelect';

const querySchema = z.string().trim().min(1, 'Upit ne smije biti prazan.');

export default function NewAnalysisModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const streamingAPI = useCourtAnalysisStream();
  const { settings } = useSettings();
  const queryInputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [scanDepth, setScanDepth] = useState('balanced');
  const [error, setError] = useState('');
  const [queryInvalid, setQueryInvalid] = useState(false);

  useEffect(() => {
    if (isOpen) setScanDepth(settings.defaultScanDepth || 'balanced');
  }, [isOpen, settings.defaultScanDepth]);


  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setQueryInvalid(false);

    const validated = querySchema.safeParse(query);
    if (!validated.success) {
      setError(validated.error.issues[0]?.message || 'Upit ne smije biti prazan.');
      setQueryInvalid(true);
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
        onError: (message) => {
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

  const errorId = 'new-analysis-error';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Nova analiza"
      description="Unesite OIB, broj predmeta ili tekstualni upit za pokretanje nove analize."
      size="sm"
      initialFocusRef={queryInputRef}
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="new-analysis-query" className="block text-sm font-medium text-[var(--text)]">
            Upit
          </label>
          <input
            ref={queryInputRef}
            id="new-analysis-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            placeholder="npr. 12345678901, St-357/2013 ili pojam za pretragu"
            autoComplete="off"
            aria-invalid={queryInvalid}
            aria-describedby={error ? errorId : undefined}
          />
          {error ? (
            <p id={errorId} role="alert" className="mt-2 rounded-md border-l-2 border-[var(--border-control)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="border-t border-[var(--border)] pt-4">
          <ScanDepthSelect value={scanDepth} onChange={setScanDepth} disabled={streamingAPI.isLoading} />
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border-control)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            disabled={streamingAPI.isLoading}
          >
            Odustani
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={streamingAPI.isLoading}
          >
            {streamingAPI.isLoading ? 'Pokrećem…' : 'Pokreni'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
