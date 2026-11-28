import { useState } from 'react';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import Dialog from '../ui/Dialog';
import { cancelAnalysisRun } from '../../lib/apiClient';

const LANE_DEFS = [
  { key: 'download', label: 'Preuzimanje' },
  { key: 'preflight', label: 'Priprema' },
  { key: 'ocr', label: 'OCR' },
  { key: 'extract', label: 'Ekstrakcija' },
];

const parseMaybeJson = (value) => {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value;
  return null;
};

const formatUsd = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return `$${num.toFixed(num < 0.1 ? 3 : 2)}`;
};

export default function LiveRunControlBar({ run, lanes, isRunning, onRefresh }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  if (!isRunning || !run) return null;

  const preflight = run.preflight || parseMaybeJson(run.preflight_json);
  const minUsd = formatUsd(preflight?.estimatedMinUsd);
  const expectedUsd = formatUsd(preflight?.estimatedExpectedUsd);
  const hasLanes = Boolean(lanes && LANE_DEFS.some(({ key }) => lanes[key]));

  const handleConfirmCancel = async () => {
    if (canceling) return;
    setCanceling(true);
    setCancelError('');
    try {
      await cancelAnalysisRun(run.id);
      setConfirmOpen(false);
      await onRefresh?.();
    } catch (err) {
      if (err?.status === 409) {
        setCancelError('Analiza je već dovršena ili otkazana.');
        await onRefresh?.();
      } else {
        setCancelError(err?.message || 'Otkazivanje analize nije uspjelo.');
      }
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div
      className="mt-4 rounded-lg border border-line bg-surface-muted/60 p-3.5 print:hidden"
      data-testid="live-run-control-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          {preflight ? (
            <>
              {minUsd || expectedUsd ? (
                <span>
                  Procjena troška:{' '}
                  <strong className="font-mono tabular-nums text-ink">
                    {minUsd && expectedUsd ? `${minUsd}–${expectedUsd}` : expectedUsd || minUsd}
                  </strong>
                </span>
              ) : null}
              {Number.isFinite(Number(preflight.cachedHits)) ? (
                <span>
                  Predmemorija:{' '}
                  <strong className="tabular-nums text-ink">{preflight.cachedHits}</strong>
                </span>
              ) : null}
              {Number.isFinite(Number(preflight.ocrPages)) ? (
                <span>
                  OCR stranice:{' '}
                  <strong className="tabular-nums text-ink">{preflight.ocrPages}</strong>
                </span>
              ) : null}
              {(Number.isFinite(Number(preflight.digitalDocs))
                || Number.isFinite(Number(preflight.scannedDocs))
                || Number.isFinite(Number(preflight.hybridDocs))) ? (
                <span className="tabular-nums">
                  Dokumenti: {preflight.digitalDocs ?? 0} dig. · {preflight.scannedDocs ?? 0} sken · {preflight.hybridDocs ?? 0} hibr.
                </span>
              ) : null}
            </>
          ) : (
            <span>Obrada u tijeku…</span>
          )}
        </div>

        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setCancelError('');
            setConfirmOpen(true);
          }}
        >
          Otkaži analizu
        </Button>
      </div>

      {hasLanes ? (
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4" data-testid="lane-progress-grid">
          {LANE_DEFS.map(({ key, label }) => {
            const lane = lanes?.[key] || null;
            const rawDone = lane?.done ?? lane?.docsDone;
            const rawTotal = lane?.total ?? lane?.docsTotal;
            const done = Number.isFinite(Number(rawDone)) ? Number(rawDone) : 0;
            const total = Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : null;
            const failed = Number.isFinite(Number(lane?.failed)) ? Number(lane.failed) : 0;
            const pagesDone = Number.isFinite(Number(lane?.pagesDone)) ? Number(lane.pagesDone) : null;
            const pagesTotal = Number.isFinite(Number(lane?.pagesTotal)) ? Number(lane.pagesTotal) : null;
            const pct = total && total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

            return (
              <div key={key} className="rounded-md border border-line bg-surface px-2.5 py-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-ink">{label}</span>
                  <span className="font-mono tabular-nums text-ink-muted">
                    {lane ? (total !== null ? `${done}/${total}` : `${done}`) : '—'}
                    {key === 'ocr' && pagesDone !== null && pagesTotal !== null ? ` · ${pagesDone}/${pagesTotal} str.` : ''}
                    {failed > 0 ? ` (${failed}✗)` : ''}
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"
                  role="progressbar"
                  aria-label={`${label} napredak`}
                  aria-valuenow={total !== null ? done : undefined}
                  aria-valuemin={total !== null ? 0 : undefined}
                  aria-valuemax={total !== null ? total : undefined}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <Dialog
        isOpen={confirmOpen}
        onClose={() => !canceling && setConfirmOpen(false)}
        title="Otkazati analizu?"
        description="Obrada će biti prekinuta i djelomični rezultati ostat će spremljeni."
        size="sm"
      >
        <div className="space-y-4">
          {cancelError ? (
            <Callout tone="danger" glyph="!" alert title="Otkazivanje nije uspjelo">
              {cancelError}
            </Callout>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmOpen(false)}
              disabled={canceling}
            >
              Nastavi analizu
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmCancel}
              disabled={canceling}
            >
              {canceling ? 'Otkazujem…' : 'Potvrdi otkazivanje'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
