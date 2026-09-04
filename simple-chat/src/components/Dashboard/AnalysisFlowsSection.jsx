const formatValue = (value, currency) => {
  const num = typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('hr-HR')
    : (value ?? '?');
  return currency ? `${num} ${currency}` : `${num}`;
};

const ASSET_TYPE_LABELS = {
  nekretnina: 'nekretnina',
  pokretnina: 'pokretnina',
  'tražbina': 'tražbina',
  drugo: 'ostalo',
};

function UngroundedMarker() {
  return (
    <span
      title="Navod nije pronađen u izvornom tekstu dokumenta"
      className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
    >
      ⚠ nepotvrđeno
    </span>
  );
}

function MoneyFlowList({ entries }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Tijek novca</h3>
      <ul className="space-y-2">
        {entries.map((entry, index) => (
          <li
            key={entry?.id || `money-${index}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]"
          >
            <span className="font-medium">
              {formatValue(entry?.amount, entry?.currency)}
            </span>
            {entry?.description ? <span> — {entry.description}</span> : null}
            {entry?.date ? <span className="text-[var(--text-muted)]"> ({String(entry.date)})</span> : null}
            {entry?.fileName ? (
              <span className="block text-xs text-[var(--text-muted)]">Izvor: {entry.fileName}</span>
            ) : null}
            {entry?.grounded === false ? <UngroundedMarker /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PropertyFlowList({ entries }) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Tijek imovine</h3>
      <ul className="space-y-2">
        {entries.map((entry, index) => (
          <li
            key={entry?.id || `property-${index}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]"
          >
            <span className="mr-2 inline-block rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {ASSET_TYPE_LABELS[entry?.assetType] || entry?.assetType || 'ostalo'}
            </span>
            <span className="font-medium">{entry?.description || '-'}</span>
            {Number.isFinite(entry?.value) ? (
              <span> — {formatValue(entry.value, entry?.currency)}</span>
            ) : null}
            {entry?.eventType ? (
              <span className="text-[var(--text-muted)]"> [{String(entry.eventType)}]</span>
            ) : null}
            {(entry?.transferor || entry?.transferee) ? (
              <span className="block text-xs text-[var(--text-muted)]">
                {entry.transferor || '?'} → {entry.transferee || '?'}
                {entry?.date ? ` · ${String(entry.date)}` : ''}
              </span>
            ) : null}
            {entry?.fileName ? (
              <span className="block text-xs text-[var(--text-muted)]">Izvor: {entry.fileName}</span>
            ) : null}
            {entry?.grounded === false ? <UngroundedMarker /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ValueChangeList({ valueChanges }) {
  if (!Array.isArray(valueChanges) || valueChanges.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-[var(--text)]">Vrijednosne promjene tražbina</h3>
      <ul className="space-y-2">
        {valueChanges.map((change, index) => (
          <li
            key={`value-change-${index}`}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]"
          >
            {change?.finding || `Vrijednosna promjena tražbine "${change?.description || '-'}".`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Money + property flow section for the analysis detail page. Each subsection
 * hides entirely when its data is empty (matches the secondary-clusters
 * hide-when-empty pattern); the whole section hides when everything is empty.
 * Ungrounded entries carry an inline "⚠ nepotvrđeno" marker in context.
 */
export default function AnalysisFlowsSection({ moneyFlow, propertyFlow, valueChanges }) {
  const moneyEntries = Array.isArray(moneyFlow?.entries) ? moneyFlow.entries : [];
  const propertyEntries = Array.isArray(propertyFlow?.entries) ? propertyFlow.entries : [];
  const changes = Array.isArray(valueChanges) ? valueChanges : [];
  if (moneyEntries.length === 0 && propertyEntries.length === 0 && changes.length === 0) return null;

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" data-testid="analysis-flows">
      <MoneyFlowList entries={moneyEntries} />
      <PropertyFlowList entries={propertyEntries} />
      <ValueChangeList valueChanges={changes} />
    </section>
  );
}
