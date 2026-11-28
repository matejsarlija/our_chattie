import Button from '../ui/Button';

const formatTokens = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return new Intl.NumberFormat('hr-HR').format(numeric);
};

const formatUsd = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return `$${numeric.toFixed(4)}`;
};

const STAGE_NAMES = {
  ocr: 'OCR',
  extraction: 'Ekstrakcija',
  synthesis: 'Sinteza',
  verify: 'Provjera',
};

export default function AnalysisUsageSummary({ usage, isRunning = false, model = null, onOpenTraces = null }) {
  if (!usage || typeof usage !== 'object') return null;

  const input = formatTokens(usage.inputTokens);
  const output = formatTokens(usage.outputTokens);
  const total = formatTokens(usage.totalTokens);
  const costUsd = formatUsd(usage.costUsd);
  const cachedTokens = formatTokens(usage.cachedTokens);
  const reasoningTokens = formatTokens(usage.reasoningTokens);

  const stats = [
    { label: 'Ulazni tokeni', value: input },
    { label: 'Izlazni tokeni', value: output },
    { label: 'Ukupno tokena', value: total },
    ...(costUsd ? [{ label: 'Trošak (USD)', value: costUsd }] : []),
  ];

  const byStage = usage.byStage && typeof usage.byStage === 'object'
    ? Object.entries(usage.byStage).filter(([, val]) => Number.isFinite(Number(val)))
    : [];

  const modelsUsed = Array.isArray(usage.modelsUsed) ? usage.modelsUsed.filter(Boolean) : [];

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink">Potrošnja tokena</h3>
        {isRunning && (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
            <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-accent" />
            ažurira se
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-line bg-surface-muted px-3 py-2">
            <p className="eyebrow">{stat.label}</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-ink">
              {stat.value ?? '—'}
            </p>
          </div>
        ))}
      </div>

      {byStage.length > 0 ? (
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="eyebrow">Trošak po fazi</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-xs">
            {byStage.map(([stageKey, usd]) => (
              <div key={stageKey} className="flex items-center justify-between rounded border border-line bg-surface-muted px-2 py-1">
                <span className="text-ink-muted">{STAGE_NAMES[stageKey] || stageKey}</span>
                <span className="font-mono tabular-nums text-ink">{formatUsd(usd)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(cachedTokens || reasoningTokens || Number.isFinite(Number(usage.cacheHitDocs)) || Number.isFinite(Number(usage.adminFastPathDocs))) ? (
        <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-ink-muted">
          {cachedTokens ? <span>Predmemorija tokena: {cachedTokens}</span> : null}
          {reasoningTokens ? <span>Razmišljanje: {reasoningTokens}</span> : null}
          {Number.isFinite(Number(usage.cacheHitDocs)) ? <span>Predmemorija dok.: {usage.cacheHitDocs}</span> : null}
          {Number.isFinite(Number(usage.adminFastPathDocs)) ? <span>Brzi put: {usage.adminFastPathDocs}</span> : null}
        </div>
      ) : null}

      {(Number.isFinite(Number(usage.calls)) || model || modelsUsed.length > 0) && (
        <p className="mt-2 text-xs text-ink-muted">
          {Number.isFinite(Number(usage.calls)) ? `${new Intl.NumberFormat('hr-HR').format(usage.calls)} poziva` : ''}
          {Number.isFinite(Number(usage.calls)) && (model || modelsUsed.length > 0) ? ' · ' : ''}
          {modelsUsed.length > 0 ? modelsUsed.join(', ') : (model || '')}
        </p>
      )}

      {onOpenTraces ? (
        <div className="mt-3 border-t border-line pt-2.5">
          <Button variant="secondary" size="sm" onClick={onOpenTraces} className="w-full">
            Forenzički tragovi (llm_traces)
          </Button>
        </div>
      ) : null}
    </section>
  );
}
