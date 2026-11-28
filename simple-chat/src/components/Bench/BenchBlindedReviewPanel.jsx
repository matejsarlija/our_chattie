import { useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import Input from '../ui/Input';

function countCandidateMetrics(text) {
  const str = String(text || '');
  const chars = str.length;
  const lines = str ? str.split('\n').length : 0;
  return { chars, lines };
}

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
    <section aria-labelledby="blinded-review-heading" className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="blinded-review-heading" className="text-base font-semibold text-ink">
            Slijepa JSON recenzija (Blinded Review)
          </h2>
          <p className="text-xs text-ink-muted">
            Usporedba anonimiziranih izlaza bez oznaka modela.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onLoadReview?.(3, 7)}
        >
          Učitaj uzorak za recenziju
        </Button>
      </div>

      {error ? <Callout tone="danger" alert title="Greška recenzije">{error}</Callout> : null}
      {submitResult ? (
        <Callout tone="success" title="Recenzija spremljena">
          Zaprimljeno ocjena: {submitResult.verdictsCount}.
        </Callout>
      ) : null}

      {!review ? (
        <p className="text-sm text-ink-muted">Kliknite gumb iznad za generiranje anonimiziranog uzorka.</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-muted">Nema kandidata za recenziju u ovom izvođenju.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {items.map((item) => (
            <div key={item.docId} className="space-y-3 rounded-lg border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">{item.title || item.docId}</h3>
                {Array.isArray(item.selectionReasons) && item.selectionReasons.length > 0 ? (
                  <span className="text-xs text-ink-muted">
                    {item.selectionReasons.join(' · ')}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                {(item.candidates || []).map((cand) => {
                  const metrics = countCandidateMetrics(cand.text);
                  return (
                    <div key={cand.label} className="rounded-md border border-line bg-surface-muted p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-ink">Kandidat {cand.label}</span>
                          <Badge tone="neutral" className="px-2 py-0.5 font-mono text-xs tabular-nums">
                            {metrics.chars} zn. · {metrics.lines} red.
                          </Badge>
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-xs text-ink">
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
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">
                        {cand.text || '(prazno)'}
                      </pre>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-ink">
                  <input
                    type="radio"
                    name={`winner-${item.docId}`}
                    value="tie"
                    checked={verdicts[item.docId]?.winner === 'tie'}
                    onChange={() => handleSelect(item.docId, 'tie')}
                  />
                  Jednako / Neodlučno
                </label>
              </div>

              <div>
                <label htmlFor={`note-${item.docId}`} className="mb-1 block text-xs text-ink-muted">
                  Napomena recenzenta
                </label>
                <Input
                  id={`note-${item.docId}`}
                  type="text"
                  value={verdicts[item.docId]?.notes || ''}
                  onChange={(e) => handleNotes(item.docId, e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>
          ))}
          <Button
            type="submit"
            variant="primary"
            disabled={submitting || Object.keys(verdicts).length === 0}
          >
            {submitting ? 'Spremam...' : 'Pošalji JSON recenziju'}
          </Button>
        </form>
      )}
    </section>
  );
}
