import { useEffect, useState } from 'react';
import { formatEur, formatDate } from './format';
import { collapseStageRuns, duplicationSummary, normalizeEventDate } from './collapseRuns';

const EVENT_TYPE_LABELS = {
  prijava: 'Prijava',
  ustup: 'Ustup',
  namirenje: 'Namirenje',
  drugo: 'Ostalo',
};

const LINKAGE_LABELS = {
  claimRegistryNumber: 'povezano rednim brojem',
  supersedes: 'povezano ustupom',
  'supersedes-inferred': 'povezano ustupom (zaključeno)',
  citation: 'povezano citatom',
};

const VALUE_ROLE_LABELS = {
  claim_balance: 'iskazani saldo tražbine',
  transfer_consideration: 'cijena ustupa',
  payment_amount: 'iznos uplate/namirenja',
  asset_value: 'vrijednost imovine',
  unknown: 'uloga iznosa nije utvrđena',
};
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);
const eventLabel = (type) => EVENT_TYPE_LABELS[type] || 'Događaj';
const hasDate = (stage) => Boolean(String(stage?.date ?? '').trim());

function pluralCount(count, one, few, many = one) {
  const remainder100 = count % 100;
  const remainder10 = count % 10;
  if (remainder100 >= 11 && remainder100 <= 14) return `${count} ${many}`;
  if (remainder10 === 1) return `${count} ${one}`;
  if (remainder10 >= 2 && remainder10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

function displayDate(value) {
  if (!value) return 'Datum nije utvrđen';
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return formatDate(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}T12:00:00Z`);
  const cro = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (cro) return formatDate(`${cro[3]}-${cro[2].padStart(2, '0')}-${cro[1].padStart(2, '0')}T12:00:00Z`);
  return raw;
}

function formatAmount(value, currency = 'EUR') {
  if (!isNum(value)) return '—';
  if (!currency || currency === 'EUR') return formatEur(value);
  return `${value.toLocaleString('hr-HR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}
function balanceComparisonExplanation(stages) {
  const valueStages = stages.filter((stage) => isNum(stage?.value));
  const balanceStages = valueStages.filter((stage) => stage?.valueRole === 'claim_balance');
  if (balanceStages.length < 2) {
    return `${balanceStages.length} od ${valueStages.length} prikazanih iznosa izričito je označeno kao saldo tražbine; za promjenu su potrebna najmanje dva usporediva salda.`;
  }
  const currencies = new Set(balanceStages.map((stage) => stage?.currency).filter(Boolean));
  if (currencies.size > 1) {
    return `Salda su u različitim valutama (${Array.from(currencies).join(', ')}) i nisu preračunata po pouzdanom tečaju, pa promjena nije izračunata.`;
  }
  return 'Valuta salda nije dovoljno utvrđena za usporedbu; promjena nije izračunata.';
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function relevantSourceRows(stages, sourceDocumentsById) {
  const seen = new Set();
  return stages
    .filter((stage) => isNum(stage?.value))
    .map((stage) => {
      const document = sourceDocumentsById.get(stage?.sourceId);
      const fileName = document?.fileName || stage?.fileName;
      if (!fileName) return null;
      const key = stage?.sourceId || fileName;
      if (seen.has(key)) return null;
      seen.add(key);
      return { fileName: String(fileName).split(/[\\/]/).pop(), url: safeHttpUrl(document?.url), key };
    })
    .filter(Boolean);
}

const DETAIL_PAGE_SIZE = 10;

function StageRecords({ records }) {
  const [page, setPage] = useState(0);
  const start = page * DETAIL_PAGE_SIZE;
  const visibleRecords = records.slice(start, start + DETAIL_PAGE_SIZE);

  return (
    <>
      <ol className="mt-2 space-y-2 border-l-2 border-line pl-3">
      {visibleRecords.map((record, index) => {
        const parties = [record?.transferor, record?.transferee].filter(Boolean).join(' → ');

        return (
          <li key={record?.id || `record-${index}`} className="text-xs leading-relaxed text-ink-muted">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="num">{record?.date ? String(record.date) : 'Datum nije naveden'}</span>
              <span aria-hidden="true">·</span>
              <span>{eventLabel(record?.eventType)}</span>
              {parties ? <span>· {parties}</span> : null}
              {isNum(record?.value) ? <span>· {formatAmount(record.value, record.currency)}</span> : null}
            </div>
            {record?.fileName ? (
              <div className="mt-0.5 break-all font-mono text-[11px]">
                {String(record.fileName).split('/').pop()}
              </div>
            ) : null}
          </li>
        );
      })}
      </ol>
      {records.length > DETAIL_PAGE_SIZE ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-muted">
          <span>Prikaz {start + 1}–{start + visibleRecords.length} od {records.length} zapisa</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((value) => value - 1)} disabled={page === 0} className="rounded border border-line-control px-2 py-1 text-ink disabled:opacity-50">Prethodna</button>
            <button type="button" onClick={() => setPage((value) => value + 1)} disabled={start + visibleRecords.length >= records.length} className="rounded border border-line-control px-2 py-1 text-ink disabled:opacity-50">Sljedeća</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function eventEffect(stage, group) {
  const parties = [stage?.transferor, stage?.transferee].filter(Boolean);
  if (stage?.eventType === 'ustup' && parties.length === 2) {
    return 'Promjena vjerovnika. Ustup sam po sebi ne potvrđuje promjenu iznosa duga.';
  }
  if (stage?.eventType === 'namirenje') {
    return 'Zapis je označen kao namirenje; iznos je iskaz iz zapisa, ne potvrda konačnog salda.';
  }
  if (group.comparedToPrevious && group.amountChanged) {
    return 'Iznos iskazan u ovom zapisu razlikuje se od prethodnog zapisa; pravni učinak treba provjeriti u izvoru.';
  }
  if (group.comparedToPrevious && isNum(stage?.value)) {
    return 'Iznos iskazan u zapisu jednak je prethodno prikazanom iznosu.';
  }
  return null;
}

function EventRow({ group }) {
  const { stage, records, recordCount, partyVariants, dateVariants } = group;
  const parties = [stage?.transferor, stage?.transferee].filter(Boolean);
  const hasValue = isNum(stage?.value);
  const effect = eventEffect(stage, group);
  const dateVariantCount = new Set(dateVariants.map(normalizeEventDate).filter(Boolean)).size;

  return (
    <li className="grid grid-cols-1 gap-1.5 border-b border-line py-3 last:border-b-0 sm:grid-cols-[8.5rem_minmax(0,1fr)_minmax(10rem,auto)] sm:items-start sm:gap-3">
      <div>
        <div className="text-sm font-medium text-ink">{displayDate(stage?.date)}</div>
        <div className="mt-0.5 text-xs text-ink-muted">{eventLabel(stage?.eventType)}</div>
      </div>

      <div className="min-w-0">
        {parties.length > 0 ? (
          <p className="wrap-break-word text-sm leading-relaxed text-ink">
            {parties.map((party, index) => (
              <span key={`${party}-${index}`}>
                {index > 0 ? <span className="px-1 text-ink-muted" aria-hidden="true">→</span> : null}
                {party}
              </span>
            ))}
          </p>
        ) : null}
        {effect ? <p className="mt-1 text-xs leading-relaxed text-ink-muted">{effect}</p> : null}
        {partyVariants > 1 ? (
          <p className="mt-1 text-xs text-ink-muted">
            {partyVariants} različitih zapisa imena ugovorne strane u izvorima.
          </p>
        ) : null}
        {stage?.valueRole ? (
          <p className="mt-1 text-xs text-ink-muted">{VALUE_ROLE_LABELS[stage.valueRole] || stage.valueRole}</p>
        ) : null}
        {stage?.crossCategoryFactId ? (
          <a
            href={`#money-entry-${stage.crossCategoryFactId}`}
            className="mt-1 inline-block text-xs font-medium text-accent underline underline-offset-2"
          >
            Isti izvorni iznos u Novčane stavke
          </a>
        ) : null}
        {dateVariantCount > 1 ? (
          <p className="mt-1 text-xs text-ink-muted">Datum se razlikuje među zapisima ove grupe.</p>
        ) : null}
        {recordCount > 1 ? (
          <details className="group mt-2">
            <summary className="cursor-pointer text-xs font-medium text-accent underline decoration-transparent underline-offset-2 hover:decoration-current">
              Izvorni zapisi · {recordCount}
            </summary>
            <StageRecords records={records} />
          </details>
        ) : stage?.fileName ? (
          <div className="mt-1.5 break-all font-mono text-[11px] text-ink-muted">
            {String(stage.fileName).split('/').pop()}
          </div>
        ) : null}
      </div>

      <div className="sm:text-right">
        <div className="num text-base font-semibold tracking-tight text-ink">
          {hasValue ? formatAmount(stage.value, stage.currency) : <span className="text-sm font-normal text-ink-muted">Nije navedeno</span>}
        </div>
        {hasValue ? <div className="text-xs text-ink-muted">iznos naveden u zapisu</div> : null}
      </div>
    </li>
  );
}

const CLAIMS_PER_PAGE = 5;
const GROUPS_PER_PAGE = 10;

function EventList({ groups }) {
  const [page, setPage] = useState(0);
  const start = page * GROUPS_PER_PAGE;
  const visibleGroups = groups.slice(start, start + GROUPS_PER_PAGE);

  return (
    <>
      <ol className="mt-1 divide-y divide-line">
        {visibleGroups.map((group, groupIndex) => (
          <EventRow key={`${group.key}-${start + groupIndex}`} group={group} />
        ))}
      </ol>
      {groups.length > GROUPS_PER_PAGE ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-muted">
          <span>Prikaz {start + 1}–{start + visibleGroups.length} od {groups.length} grupa</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((value) => value - 1)} disabled={page === 0} className="rounded border border-line-control px-2 py-1 text-ink disabled:opacity-50">Prethodna</button>
            <button type="button" onClick={() => setPage((value) => value + 1)} disabled={start + visibleGroups.length >= groups.length} className="rounded border border-line-control px-2 py-1 text-ink disabled:opacity-50">Sljedeća</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function LifecycleTimeline({ valueChanges = [], sourceDocuments = [], embedded = false }) {
  const [page, setPage] = useState(0);
  const changes = Array.isArray(valueChanges) ? valueChanges : [];
  const sourceDocumentsById = new Map(
    (Array.isArray(sourceDocuments) ? sourceDocuments : [])
      .filter((document) => document?.id)
      .map((document) => [document.id, document]),
  );
  useEffect(() => {
    setPage(0);
  }, [valueChanges]);
  if (changes.length === 0) return null;

  const pageCount = Math.ceil(changes.length / CLAIMS_PER_PAGE);
  const start = page * CLAIMS_PER_PAGE;
  const visibleChanges = changes.slice(start, start + CLAIMS_PER_PAGE);

  return (
    <section
      className={embedded ? '' : 'card p-5'}
      aria-label={embedded ? 'Povijest tražbina' : undefined}
      aria-labelledby={embedded ? undefined : 'lifecycle-heading'}
      data-testid="lifecycle-timeline"
    >
      {!embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="lifecycle-heading" className="sec-title">Povijest tražbina</h2>
            <p className="mt-1 text-sm text-ink-muted">{pluralCount(changes.length, 'tražbina', 'tražbine')}</p>
          </div>
        </div>
      ) : null}

      {visibleChanges.map((change, pageIndex) => {
        const index = start + pageIndex;
        const stages = Array.isArray(change?.stages) ? change.stages : [];
        const groups = collapseStageRuns(stages);
        const datedGroups = groups.filter((group) => hasDate(group.stage));
        const undatedGroups = groups.filter((group) => !hasDate(group.stage));
        const sourceRows = relevantSourceRows(stages, sourceDocumentsById);
        const summary = duplicationSummary(stages);
        const hasExplicitComparableBalances = change?.comparisonStatus === 'comparable'
          && stages.filter((stage) => stage?.valueRole === 'claim_balance' && isNum(stage?.value)).length >= 2;
        const original = hasExplicitComparableBalances && isNum(change?.originalValue) ? change.originalValue : null;
        const latest = hasExplicitComparableBalances && isNum(change?.latestValue) ? change.latestValue : null;
        const delta = hasExplicitComparableBalances && isNum(change?.delta) ? change.delta : null;
        const pct = hasExplicitComparableBalances && isNum(change?.discountPct) ? change.discountPct : null;
        const currency = change?.currency || 'EUR';

        return (
          <article
            key={`lifecycle-${index}`}
            className={index === 0 ? 'mt-4' : 'mt-6 border-t border-line pt-5'}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold leading-snug text-ink">
                  {change?.description || 'Tražbina'}
                </h3>
                {change?.linkage ? (
                  <p className="mt-1 text-xs text-ink-muted">
                    {LINKAGE_LABELS[change.linkage] || 'povezano'}
                  </p>
                ) : null}
              </div>
            </div>

            {original !== null || latest !== null ? (
              <div className="mt-4 grid grid-cols-1 gap-3 border-y border-line py-3 sm:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
                <div>
                  <div className="eyebrow">Prijavljeni izvorni iznos</div>
                  <div className="num mt-1 text-lg font-semibold tracking-tight text-ink">
                    {original === null ? '—' : formatAmount(original, currency)}
                  </div>
                </div>
                <span aria-hidden="true" className="hidden pb-1 text-center text-ink-muted sm:block">→</span>
                <div>
                  <div className="eyebrow">Kasnije zabilježeni iznos</div>
                  <div className="num mt-1 text-lg font-semibold tracking-tight text-ink">
                    {latest === null ? '—' : formatAmount(latest, currency)}
                  </div>
                </div>
                {delta !== null ? (
                  <div className="sm:text-right">
                    <div className="eyebrow">Razlika prema izvješću</div>
                    <div className="num mt-1 text-base font-semibold tracking-tight text-ink">
                      {delta > 0 ? '+' : delta < 0 ? '−' : ''}{formatAmount(Math.abs(delta), currency)}
                    </div>
                    {pct !== null ? (
                      <div className="num text-xs text-ink-muted">
                        {pct > 0 ? '+' : pct < 0 ? '−' : ''}
                        {Math.abs(pct).toLocaleString('hr-HR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}&nbsp;%
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {!hasExplicitComparableBalances && (
              change?.comparisonStatus === 'not-comparable'
              || stages.some((stage) => isNum(stage?.value))
              || isNum(change?.originalValue)
              || isNum(change?.latestValue)
            ) ? (
              <div
                className="mt-3 rounded-md border border-dashed border-line-control bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-muted"
                data-testid="claim-balance-not-compared"
              >
                <p>
                  Saldo nije izračunat. {balanceComparisonExplanation(stages)}
                </p>
                {sourceRows.length > 0 ? (
                  <p className="mt-1">
                    Provjerite izvorne zapise:{' '}
                    {sourceRows.map((source, sourceIndex) => (
                      <span key={source.key}>
                        {sourceIndex > 0 ? ', ' : ''}
                        {source.url ? (
                          <a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
                            {source.fileName}
                          </a>
                        ) : source.fileName}
                      </span>
                    ))}
                  </p>
                ) : null}
              </div>
            ) : null}

            {summary && summary.repeatedRecords > 0 ? (
              <p className="mt-3 border-l-2 border-line-control bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-muted">
                <strong className="font-semibold text-ink">
                  {pluralCount(summary.totalRecords, 'izvorni zapis', 'izvorna zapisa', 'izvornih zapisa')} ·{' '}
                  {pluralCount(summary.eventCount, 'prikazana grupa', 'prikazane grupe', 'prikazanih grupa')}.
                </strong>{' '}
                Grupiranje olakšava pregled; broj zapisa nije broj pravnih događaja i povezanost treba provjeriti u izvorima.
              </p>
            ) : null}

            <h4 className="mt-4 text-sm font-semibold text-ink">Događaji u dostupnim zapisima</h4>
            {datedGroups.length > 0 ? <EventList groups={datedGroups} /> : null}

            {undatedGroups.length > 0 ? (
              <details className="mt-3 border border-dashed border-line-control px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  Datum nije utvrđen · {pluralCount(undatedGroups.reduce((count, group) => count + group.recordCount, 0), 'izvorni zapis', 'izvorna zapisa', 'izvornih zapisa')}
                </summary>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  Ovi zapisi nisu umetnuti u kronologiju jer datum nije dostupan. Redoslijed i povezanost provjerite u izvorima.
                </p>
                <EventList groups={undatedGroups} />
              </details>
            ) : null}

            {groups.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                {change?.finding || 'Detalji promjene nisu dostupni.'}
              </p>
            ) : null}
          </article>
        );
      })}

      {pageCount > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
          <span>Prikaz {start + 1}–{start + visibleChanges.length} od {changes.length} tražbina</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPage((value) => value - 1)} disabled={page === 0} className="rounded-md border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Prethodna</button>
            <button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= pageCount - 1} className="rounded-md border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Sljedeća</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
