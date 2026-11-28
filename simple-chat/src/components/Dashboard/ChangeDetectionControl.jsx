import { useNavigate } from 'react-router-dom';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import { formatDateTime } from '../ui/format';
import { useChangeDetection } from '../../hooks/useChangeDetection';

function summarizeDiff(diff) {
  if (!diff || typeof diff !== 'object') {
    return { added: 0, changed: 0, removed: 0, total: 0 };
  }
  const added = Array.isArray(diff.added) ? diff.added.length : 0;
  const changed = Array.isArray(diff.changed) ? diff.changed.length : 0;
  const removed = Array.isArray(diff.removed) ? diff.removed.length : 0;
  const total = added + changed + removed;
  return { added, changed, removed, total };
}

export function ChangeDetectionNotice({ latestCheck, error, onStartNewAnalysis }) {
  const navigate = useNavigate();

  const handleNewAnalysis = () => {
    if (onStartNewAnalysis) {
      onStartNewAnalysis();
      return;
    }
    navigate('/dashboard?new=1');
  };

  if (error) {
    return (
      <Callout tone="danger" glyph="!" alert title="Provjera novih objava nije uspjela">
        {error}
      </Callout>
    );
  }

  if (!latestCheck) return null;

  const counts = summarizeDiff(latestCheck.diff);
  const hasChanges = counts.total > 0 || latestCheck.diff?.hasChanges === true;

  if (hasChanges) {
    const parts = [];
    if (counts.added > 0) parts.push(`${counts.added} novih`);
    if (counts.changed > 0) parts.push(`${counts.changed} izmijenjenih`);
    if (counts.removed > 0) parts.push(`${counts.removed} uklonjenih`);

    return (
      <Callout
        tone="info"
        title="Pronađene su nove ili izmijenjene objave"
        action={(
          <Button variant="primary" size="sm" onClick={handleNewAnalysis}>
            Pokreni novu analizu
          </Button>
        )}
      >
        <p>
          Zabilježene promjene u odnosu na prethodnu snimku:{' '}
          <span className="font-medium text-ink">{parts.join(', ') || 'promjena u objavama'}</span>.
        </p>
      </Callout>
    );
  }

  return (
    <Callout tone="success" title="Nema novih objava od zadnje provjere">
      <p>Svi zapisi na e-Oglasnoj ploči odgovaraju zadnjem stanju.</p>
    </Callout>
  );
}

export default function ChangeDetectionControl({
  queryType,
  queryValue,
  status,
  hookState = null,
  inlineNotice = true,
  onStartNewAnalysis,
}) {
  const internalState = useChangeDetection({
    queryType,
    queryValue,
    status,
    enabled: !hookState,
  });
  const state = hookState || internalState;

  if (!state.isEligible) return null;

  const lastCheckedAt = state.latestCheck?.checkedAt || state.history?.lastCheckedAt || null;

  return (
    <>
      <div className="inline-flex flex-wrap items-center gap-2" data-testid="change-detection-control">
        <Button
          variant="secondary"
          size="sm"
          onClick={state.checkNow}
          disabled={state.checking}
        >
          {state.checking ? 'Provjeravam objave…' : 'Provjeri nove objave'}
        </Button>
        {lastCheckedAt ? (
          <span className="hidden text-xs tabular-nums text-ink-muted sm:inline">
            Zadnja provjera: {formatDateTime(lastCheckedAt)}
          </span>
        ) : null}
      </div>
      {inlineNotice ? (
        <div className="mt-3 w-full">
          <ChangeDetectionNotice
            latestCheck={state.latestCheck}
            error={state.error}
            onStartNewAnalysis={onStartNewAnalysis}
          />
        </div>
      ) : null}
    </>
  );
}
