import { useDeferredValue, useMemo, useState } from 'react';
import { formatEur } from '../ui/format';
import LifecycleTimeline from '../ui/LifecycleTimeline';

const ASSET_TYPE_LABELS = {
  nekretnina: 'nekretnina',
  pokretnina: 'pokretnina',
  tražbina: 'tražbina',
  drugo: 'ostalo',
};

const DIRECTION_LABELS = {
  potraživanje: 'potraživanje',
  obveza: 'obveza',
  awarded: 'dosuđeno',
  rejected: 'odbijeno',
  netted: 'prebijeno',
};

const EVENT_TYPE_LABELS = {
  prijava: 'Prijava',
  ustup: 'Ustup',
  namirenje: 'Namirenje',
  drugo: 'Ostalo',
};

const AMOUNT_ROLE_LABELS = {
  total: 'ukupno',
  line_item: 'stavka',
  principal: 'glavnica',
  cost: 'trošak',
  paid: 'plaćeno',
  fee: 'naknada',
};

const VALUE_ROLE_LABELS = {
  claim_balance: 'iskazani saldo tražbine',
  transfer_consideration: 'cijena ustupa',
  payment_amount: 'iznos uplate ili namirenja',
  asset_value: 'vrijednost imovine',
  unknown: 'uloga iznosa nije utvrđena',
};

const PAGE_SIZE = 10;
const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

function formatSourceAmount(amount, currency) {
  if (!currency || currency === 'EUR') return null;
  const numeric = typeof amount === 'number'
    ? amount
    : Number(String(amount ?? '').replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  return `${numeric.toLocaleString('hr-HR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('hr-HR')
    .trim();
}

function dateSortKey(value) {
  const raw = String(value || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return Number(`${iso[1]}${iso[2].padStart(2, '0')}${iso[3].padStart(2, '0')}`);
  const cro = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (cro) return Number(`${cro[3]}${cro[2].padStart(2, '0')}${cro[1].padStart(2, '0')}`);
  return 0;
}

function buildEvidenceRows(moneyEntries, propertyEntries) {
  const rows = [];
  const byCrossCategoryId = new Map();
  let rowIndex = 0;

  const append = (entry, kind) => {
    if (!entry || typeof entry !== 'object') return;
    const crossCategoryFactId = typeof entry.crossCategoryFactId === 'string'
      ? entry.crossCategoryFactId
      : null;
    let row = crossCategoryFactId ? byCrossCategoryId.get(crossCategoryFactId) : null;
    if (!row) {
      rowIndex += 1;
      row = {
        id: crossCategoryFactId || `${kind}:${entry.id || rowIndex}`,
        crossCategoryFactId,
        moneyEntries: [],
        propertyEntries: [],
        categories: new Set(),
      };
      rows.push(row);
      if (crossCategoryFactId) byCrossCategoryId.set(crossCategoryFactId, row);
    }
    row[kind === 'money' ? 'moneyEntries' : 'propertyEntries'].push(entry);
    row.categories.add(kind);
  };

  for (const entry of Array.isArray(moneyEntries) ? moneyEntries : []) append(entry, 'money');
  for (const entry of Array.isArray(propertyEntries) ? propertyEntries : []) append(entry, 'property');

  return rows.sort((left, right) => {
    const dateDifference = dateSortKey(rowDate(right)) - dateSortKey(rowDate(left));
    return dateDifference || String(left.id).localeCompare(String(right.id));
  });
}

function rowDate(row) {
  return row.propertyEntries.find((entry) => entry?.date)?.date
    || row.moneyEntries.find((entry) => entry?.date)?.date
    || '';
}

function rowDescription(row) {
  return row.propertyEntries.find((entry) => entry?.description)?.description
    || row.moneyEntries.find((entry) => entry?.description)?.description
    || 'Opis nije dostupan';
}

function rowFigure(row) {
  const money = row.moneyEntries.find((entry) => isNum(entry?.amountEur) || isNum(entry?.amount));
  const property = row.propertyEntries.find((entry) => isNum(entry?.valueEur) || isNum(entry?.value));
  const moneyValue = isNum(money?.amountEur) ? money.amountEur : money?.amount;
  const propertyValue = isNum(property?.valueEur) ? property.valueEur : property?.value;
  if (isNum(moneyValue) && isNum(propertyValue) && Math.abs(moneyValue - propertyValue) > 0.01) {
    return { mismatch: true, value: null, currency: null, source: null };
  }
  if (isNum(moneyValue)) {
    return {
      mismatch: false,
      value: moneyValue,
      currency: money?.amountEur != null || money?.currency === 'EUR' ? 'EUR' : money?.currency,
      source: formatSourceAmount(money?.amount, money?.currency),
    };
  }
  if (isNum(propertyValue)) {
    return {
      mismatch: false,
      value: propertyValue,
      currency: property?.valueEur != null || property?.currency === 'EUR' ? 'EUR' : property?.currency,
      source: formatSourceAmount(property?.value, property?.currency),
    };
  }
  return { mismatch: false, value: null, currency: null, source: null };
}

function rowSearchText(row, sourceDocumentsById) {
  const fields = [];
  for (const entry of [...row.moneyEntries, ...row.propertyEntries]) {
    fields.push(
      entry?.description,
      entry?.quote,
      entry?.fileName,
      entry?.date,
      entry?.claimRegistryNumber,
      entry?.filingReference,
      entry?.transferor,
      entry?.transferee,
      entry?.payerName,
      entry?.recipientName,
      entry?.from,
      entry?.to,
      entry?.direction,
      entry?.assetType,
      entry?.eventType,
    );
    const document = sourceDocumentsById.get(entry?.sourceId);
    fields.push(document?.fileName);
  }
  return normalizeSearch(fields.filter(Boolean).join(' '));
}

function rowsForSources(row, sourceDocumentsById) {
  const sources = new Map();
  for (const entry of [...row.moneyEntries, ...row.propertyEntries]) {
    const document = sourceDocumentsById.get(entry?.sourceId);
    const fileName = document?.fileName || entry?.fileName;
    if (!fileName) continue;
    const key = entry?.sourceId || fileName;
    if (!sources.has(key)) {
      sources.set(key, {
        key,
        fileName: String(fileName).split(/[\\/]/).pop(),
        url: document?.url || null,
      });
    }
  }
  return [...sources.values()];
}

function uniqueDescriptions(row) {
  return [...new Set([...row.moneyEntries, ...row.propertyEntries]
    .map((entry) => String(entry?.description || '').trim())
    .filter(Boolean))];
}

function rowGrounding(row) {
  const entries = [...row.moneyEntries, ...row.propertyEntries];
  if (entries.length === 0 || entries.some((entry) => entry?.grounded !== true)) return false;
  return true;
}

function CategoryChip({ children }) {
  return <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-muted">{children}</span>;
}

function RecordDetails({ row, sourceDocumentsById }) {
  const descriptions = uniqueDescriptions(row);
  const sources = rowsForSources(row, sourceDocumentsById);
  const moneyEntries = row.moneyEntries;
  const propertyEntries = row.propertyEntries;
  const facts = [...moneyEntries, ...propertyEntries];
  const quotes = [...new Set(facts.map((entry) => String(entry?.quote || '').trim()).filter(Boolean))];

  return (
    <div className="mt-3 space-y-3 border-l-2 border-line pl-3 text-xs leading-relaxed text-ink-muted">
      {descriptions.length > 1 ? (
        <div>
          <div className="eyebrow">Opisi iz izvora</div>
          <ul className="mt-1 space-y-1">
            {descriptions.map((description) => <li key={description}>{description}</li>)}
          </ul>
        </div>
      ) : null}
      {quotes.length > 0 ? (
        <div>
          <div className="eyebrow">Navod iz dokumenta</div>
          {quotes.map((quote) => <blockquote key={quote} className="mt-1 italic">„{quote}”</blockquote>)}
        </div>
      ) : null}
      {moneyEntries.length > 0 ? (
        <div>
          <div className="eyebrow">Novčana tvrdnja</div>
          <ul className="mt-1 space-y-1">
            {moneyEntries.map((entry, index) => (
              <li key={entry?.id || `money-detail-${index}`}>
                {[DIRECTION_LABELS[entry?.direction] || entry?.direction, AMOUNT_ROLE_LABELS[entry?.amountRole] || entry?.amountRole, EVENT_TYPE_LABELS[entry?.eventType] || entry?.eventType, entry?.claimRegistryNumber ? `redni broj ${entry.claimRegistryNumber}` : null, entry?.filingReference]
                  .filter(Boolean).join(' · ') || 'Novčana stavka'}
                {entry?.amountEur != null && entry?.currency && entry.currency !== 'EUR'
                  ? ` · izvorno ${formatSourceAmount(entry.amount, entry.currency)}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {propertyEntries.length > 0 ? (
        <div>
          <div className="eyebrow">Imovinski događaj</div>
          <ul className="mt-1 space-y-1">
            {propertyEntries.map((entry, index) => (
              <li key={entry?.id || `property-detail-${index}`}>
                {[ASSET_TYPE_LABELS[entry?.assetType] || entry?.assetType, EVENT_TYPE_LABELS[entry?.eventType] || entry?.eventType, VALUE_ROLE_LABELS[entry?.valueRole] || entry?.valueRole, entry?.transferor, entry?.transferee, entry?.identifier, entry?.claimRegistryNumber ? `redni broj ${entry.claimRegistryNumber}` : null, entry?.filingReference]
                  .filter(Boolean).join(' · ') || 'Imovinska stavka'}
                {entry?.valueEur != null && entry?.currency && entry.currency !== 'EUR'
                  ? ` · izvorno ${formatSourceAmount(entry.value, entry.currency)}`
                  : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sources.length > 0 && rowGrounding(row) ? (
        <div>
          <div className="eyebrow">Izvorni dokumenti</div>
          <ul className="mt-1 space-y-1">
            {sources.map((source) => (
              <li key={source.key}>
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
                    {source.fileName}
                  </a>
                ) : source.fileName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {facts.some((entry) => entry?.duplicateCount > 1) ? (
        <p>
          Izvor sadrži ponovljene ekstrakcije; spajanje čuva multiplicitet i podrijetlo, ne tvrdi da je zapis pravno nevažan.
        </p>
      ) : null}
      {!rowGrounding(row) ? (
        <p className="font-medium text-warning">Navod nije potvrđen u izvornom tekstu ili potvrda nije dostupna.</p>
      ) : null}
    </div>
  );
}

function EvidenceRow({ row, sourceDocumentsById }) {
  const date = rowDate(row);
  const description = rowDescription(row);
  const figure = rowFigure(row);
  const propertyTypes = [...new Set(row.propertyEntries.map((entry) => ASSET_TYPE_LABELS[entry?.assetType] || entry?.assetType).filter(Boolean))];
  const moneyDirections = [...new Set(row.moneyEntries.map((entry) => DIRECTION_LABELS[entry?.direction] || entry?.direction).filter(Boolean))];
  const eventTypes = [...new Set([...row.moneyEntries, ...row.propertyEntries]
    .map((entry) => EVENT_TYPE_LABELS[entry?.eventType] || entry?.eventType)
    .filter(Boolean))];
  const parties = [...new Set([...row.moneyEntries, ...row.propertyEntries]
    .flatMap((entry) => [entry?.transferor, entry?.transferee, entry?.payerName || entry?.from, entry?.recipientName || entry?.to])
    .filter(Boolean))];
  const multipleCategories = row.moneyEntries.length > 0 && row.propertyEntries.length > 0;
  const sources = rowsForSources(row, sourceDocumentsById);
  const amountLabel = isNum(figure.value)
    ? figure.currency && figure.currency !== 'EUR'
      ? `${figure.value.toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${figure.currency}`
      : formatEur(figure.value)
    : 'Iznos nije naveden';

  return (
    <li className="border-b border-line last:border-b-0" data-testid="evidence-record-row">
      <details className="group py-3">
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="num shrink-0 text-xs text-ink-muted">{date || 'Datum nije naveden'}</span>
              <span className={`text-sm font-medium ${rowGrounding(row) ? 'text-ink' : 'text-ink-muted'}`}>{description}</span>
            </div>
            {parties.length > 0 ? <div className="mt-1 truncate text-xs text-ink-muted">{parties.join(' · ')}</div> : null}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {row.categories.has('money') ? <CategoryChip>Novčane stavke</CategoryChip> : null}
              {row.categories.has('property') ? <CategoryChip>Imovina</CategoryChip> : null}
              {propertyTypes.includes('tražbina') ? <CategoryChip>tražbina</CategoryChip> : null}
              {moneyDirections.map((direction) => <CategoryChip key={`direction-${direction}`}>{direction}</CategoryChip>)}
              {eventTypes.map((eventType) => <CategoryChip key={`event-${eventType}`}>{eventType}</CategoryChip>)}
              {!rowGrounding(row) ? <span className="inline-flex items-center gap-1 rounded bg-warning-surface px-1.5 py-0.5 text-xs font-semibold text-warning"><span aria-hidden="true">⚠</span> provjerite izvor</span> : null}
            </div>
            {multipleCategories ? (
              <p className="mt-1 text-xs text-ink-muted">Isti izvorni podatak u dvije kategorije; prikazan jednom.</p>
            ) : null}
            {!rowGrounding(row) && sources.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="font-medium text-warning">Provjerite izvor:</span>
                {sources.map((source) => source.url ? (
                  <a key={source.key} href={source.url} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
                    {source.fileName}
                  </a>
                ) : <span key={source.key} className="text-ink-muted">{source.fileName}</span>)}
              </div>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <div className="num text-sm font-semibold text-ink">
              {figure.mismatch ? 'Provjerite iznose' : amountLabel}
            </div>
            {figure.source ? <div className="mt-0.5 text-xs text-ink-muted">izvorno {figure.source}</div> : null}
          </div>
        </summary>
        <RecordDetails row={row} sourceDocumentsById={sourceDocumentsById} />
      </details>
    </li>
  );
}

function matchesClaimHistory(change, search) {
  if (!search) return true;
  const stages = Array.isArray(change?.stages) ? change.stages : [];
  const text = normalizeSearch([
    change?.description,
    change?.finding,
    ...stages.flatMap((stage) => [stage?.fileName, stage?.date, stage?.transferor, stage?.transferee, stage?.valueRole]),
  ].filter(Boolean).join(' '));
  return text.includes(search);
}

export default function AnalysisFlowsSection({ moneyFlow, propertyFlow, valueChanges, sourceDocuments = [] }) {
  const [activeView, setActiveView] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const deferredSearch = useDeferredValue(normalizeSearch(search));
  const moneyEntries = Array.isArray(moneyFlow?.entries) ? moneyFlow.entries : [];
  const propertyEntries = Array.isArray(propertyFlow?.entries) ? propertyFlow.entries : [];
  const changes = Array.isArray(valueChanges) ? valueChanges : [];
  const sourceDocumentsById = useMemo(
    () => new Map((Array.isArray(sourceDocuments) ? sourceDocuments : []).map((document) => [document.id, document])),
    [sourceDocuments],
  );
  const rows = useMemo(
    () => buildEvidenceRows(moneyEntries, propertyEntries),
    [moneyEntries, propertyEntries],
  );
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (activeView === 'money' && !row.categories.has('money')) return false;
    if (activeView === 'property' && !row.categories.has('property')) return false;
    if (activeView === 'claim-history') return false;
    return rowSearchText(row, sourceDocumentsById).includes(deferredSearch);
  }), [rows, activeView, deferredSearch, sourceDocumentsById]);
  const filteredChanges = useMemo(
    () => changes.filter((change) => matchesClaimHistory(change, deferredSearch)),
    [changes, deferredSearch],
  );
  if (rows.length === 0 && changes.length === 0) return null;

  const views = [
    { id: 'all', label: 'Sve', count: rows.length },
    ...(moneyEntries.length > 0 ? [{ id: 'money', label: 'Novčane stavke', count: rows.filter((row) => row.categories.has('money')).length }] : []),
    ...(propertyEntries.length > 0 ? [{ id: 'property', label: 'Imovina', count: rows.filter((row) => row.categories.has('property')).length }] : []),
    ...(changes.length > 0 ? [{ id: 'claim-history', label: 'Povijest tražbina', count: changes.length }] : []),
  ];
  const isClaimHistory = activeView === 'claim-history';
  const visibleRows = filteredRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const visibleChanges = filteredChanges;
  const visibleCount = isClaimHistory ? filteredChanges.length : filteredRows.length;
  const pageCount = isClaimHistory ? 1 : Math.ceil(visibleCount / PAGE_SIZE);
  const rowSources = new Set(rows.flatMap((row) => [...row.moneyEntries, ...row.propertyEntries]
    .map((entry) => entry?.sourceId).filter(Boolean)));
  const ungroundedCount = rows.filter((row) => !rowGrounding(row)).length;

  const changeView = (nextView) => {
    setActiveView(nextView);
    setPage(0);
  };
  const changeSearch = (event) => {
    setSearch(event.target.value);
    setPage(0);
  };

  return (
    <section id="analysis-flows" data-testid="analysis-flows" className="space-y-3 scroll-mt-20">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="sec-title">Dokazi: financijske i imovinske stavke</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {rows.length} jedinstvenih prikazanih zapisa · {rowSources.size} izvornih dokumenata
            </p>
          </div>
          {ungroundedCount > 0 ? (
            <p className="rounded bg-warning-surface px-2.5 py-1.5 text-xs font-medium text-warning">
              {ungroundedCount} zapisa zahtijeva provjeru izvora
            </p>
          ) : null}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Isti izvorni podatak može pripadati u više kategorija; u prikazu Sve prikazan je jednom. Zbroj različitih tvrdnji se ne prikazuje.
        </p>
      </div>

      <div className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Filtriraj zapise" className="flex flex-wrap gap-2">
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                aria-pressed={activeView === view.id}
                onClick={() => changeView(view.id)}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${activeView === view.id ? 'border-[var(--text)] bg-[var(--text)] text-[var(--surface)]' : 'border-line-control text-ink hover:bg-surface-muted'}`}
              >
                {view.label} <span className="num opacity-80">{view.count}</span>
              </button>
            ))}
          </div>
          <label className="flex min-w-[14rem] flex-1 items-center gap-2 sm:max-w-xs">
            <span className="sr-only">Traži u opisima, zapisima i izvorima</span>
            <input
              type="search"
              value={search}
              onChange={changeSearch}
              placeholder="Traži opis, stranku ili dokument"
              className="w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        </div>

        {isClaimHistory ? (
          <div className="mt-4">
            {visibleChanges.length > 0 ? (
              <LifecycleTimeline valueChanges={visibleChanges} sourceDocuments={sourceDocuments} embedded />
            ) : (
              <p className="mt-4 rounded-md border border-dashed border-line-control p-4 text-sm text-ink-muted">Nema povijesti tražbina koja odgovara pretrazi.</p>
            )}
          </div>
        ) : (
          <>
            {visibleRows.length > 0 ? (
              <ul className="mt-3" data-testid="evidence-register-rows">
                {visibleRows.map((row) => <EvidenceRow key={row.id} row={row} sourceDocumentsById={sourceDocumentsById} />)}
              </ul>
            ) : (
              <p className="mt-4 rounded-md border border-dashed border-line-control p-4 text-sm text-ink-muted">
                {rows.length === 0 ? 'U ovoj analizi nema financijskih ni imovinskih zapisa.' : 'Nema zapisa koji odgovaraju pretrazi.'}
              </p>
            )}
          </>
        )}

        {pageCount > 1 ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-xs text-ink-muted">
            <span>Prikaz {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, visibleCount)} od {visibleCount}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0} className="rounded border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Prethodna</button>
              <button type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1} className="rounded border border-line-control px-2.5 py-1.5 text-ink disabled:opacity-50">Sljedeća</button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
