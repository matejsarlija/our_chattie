import { useState } from 'react';
import Callout from '../ui/Callout';

export default function BenchBlindedReviewPanel({ review, onLoadReview, onSubmitVerdicts }) {
  const [verdicts, setVerdicts] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [error, setError] = useState(null);

  const items = review?.items || [];

  const handleSelect = (docId, winner) => {
    setVerdicts((prev) => ({ ...prev, [docId]: { ...(prev[docId] || {}), docId, winner } }));
  };

  const handleNotes = (docId, notes) => {
    setVerdicts((prev) => ({ ...prev, [docId]: { ...(prev[docId] || {}), docId, notes } }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const list = Object.values(verdicts);
      const res = await onSubmitVerdicts?.(list);
      setSubmitResult(res);
    } catch (err) {
      setError(err.message || 'Slanje ocjena nije uspjelo.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="blinded-review-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 id="blinded-review-heading" className="text-base font-semibold text-[var(--text)]">
            Slijepa JSON recenzija (Blinded Review)
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            Usporedba anonimiziranih izlaza bez oznaka modela.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onLoadReview?.(3, 7)}
          className="rounded-lg border border-[var(--border-control)] px-3 py-1.5 text-sm font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
        >
          Učitaj uzorak za recenziju
        </button>
      </div>

      {error ? <Callout tone="danger" alert title="Greška recenzije">{error}</Callout> : null}
      {submitResult ? (
        <Callout tone="success" title="Recenzija spremljena">
          Zaprimljeno ocjena: {submitResult.verdictsCount}.
        </Callout>
      ) : null}

      {!review ? (
        <p className="text-sm text-[var(--text-muted)]">Kliknite gumb iznad za generiranje anonimiziranog uzorka.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">Nema kandidata za recenziju u ovom izvođenju.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {items.map((item) => (
            <div key={item.docId} className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[var(--text)]">{item.title || item.docId}</h3>
                <span className="text-xs text-[var(--text-muted)]">
                  {(item.selectionReasons || []).join(' · ')}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {(item.candidates || []).map((cand) => (
                  <div key={cand.label} className="rounded border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[var(--text)]">Kandidat {cand.label}</span>
                      <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text)]">
                        <input
                          type="radio"
                          name={`winner-${item.docId}`}
                          value={cand.label}
                          checked={verdicts[item.docId]?.winner === cand.label}
                          onChange={() => handleSelect(item.docId, cand.label)}
                        />
                        Bolji izlaz
                      </label>
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-[var(--text-muted)]">
                      {cand.text || '(prazno)'}
                    </pre>
                  </div>
                ))}
              </div>
              <div>
                <label htmlFor={`note-${item.docId}`} className="block text-xs text-[var(--text-muted)] mb-1">
                  Napomena recenzenta
                </label>
                <input
                  id={`note-${item.docId}`}
                  type="text"
                  value={verdicts[item.docId]?.notes || ''}
                  onChange={(e) => handleNotes(item.docId, e.target.value)}
                  className="w-full rounded border border-[var(--border-control)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)]"
                />
              </div>
            </div>
          ))}
          <button
            type="submit"
            disabled={submitting || Object.keys(verdicts).length === 0}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Spremam...' : 'Pošalji JSON recenziju'}
          </button>
        </form>
      )}
    </section>
  );
}
