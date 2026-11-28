import { useMemo, useState } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import Input from '../ui/Input';
import { formatDate, formatEur, formatSourceAmount } from '../ui/format';
import { useRunFacts } from '../../hooks/useRunFacts';
import AnalysisDocumentParties from './AnalysisDocumentParties';

const KIND_OPTIONS = [
  { value: '', label: 'Sve' },
  { value: 'amount', label: 'Iznosi' },
  { value: 'property', label: 'Imovina' },
  { value: 'party', label: 'Stranke' },
  { value: 'procedural_outcome', label: 'Postupovni ishodi' },
];

const KIND_LABELS = {
  amount: 'Iznos',
  property: 'Imovina',
  party: 'Stranka',
  procedural_outcome: 'Postupovni ishod',
};

const ROLE_LABELS = {
  duznik: 'Dužnik',
  dužnik: 'Dužnik',
  vjerovnik: 'Vjerovnik',
  stecajni_upravitelj: 'Stečajni upravitelj',
  platitelj: 'Platitelj',
  primatelj: 'Primatelj',
  prenositelj: 'Prenositelj',
  stjecatelj: 'Stjecatelj',
  sud: 'Sud',
};

function formatRoleLabel(role) {
  const key = String(role || '').trim().toLowerCase();
  return ROLE_LABELS[key] || role;
}

function normalizeCreditors(creditorDigest) {
  if (!creditorDigest) return [];
  if (Array.isArray(creditorDigest)) return creditorDigest;
  if (Array.isArray(creditorDigest.topCreditors)) return creditorDigest.topCreditors;
  if (Array.isArray(creditorDigest.creditors)) return creditorDigest.creditors;
  if (Array.isArray(creditorDigest.byPriorityClass)) {
    return creditorDigest.byPriorityClass.flatMap((group) => (
      Array.isArray(group?.creditors)
        ? group.creditors.map((c) => ({ ...c, isplatniRed: c.isplatniRed || group.isplatniRed || group.priorityClass }))
        : []
    ));
  }
  return [];
}

function formatFactAmount(fact) {
  if (typeof fact?.valueEur === 'number' && Number.isFinite(fact.valueEur)) {
    const eur = formatEur(fact.valueEur);
    const source = fact.currency && fact.currency !== 'EUR'
      ? formatSourceAmount(fact.valueHrk ?? fact.value, fact.currency)
      : null;
    return source ? `${eur} (${source})` : eur;
  }
  if (fact?.value !== null && fact?.value !== undefined && fact?.value !== '') {
    return formatSourceAmount(fact.value, fact.currency || 'EUR') || `${fact.value} ${fact.currency || ''}`.trim();
  }
  return '—';
}

export default function AnalysisEntitiesExplorer({
  runId,
  canonicalParties = [],
  creditorDigest = null,
  legacyAnalyses = [],
  sourceDocuments = [],
  onOpenEvidence,
}) {
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedPartyLabel, setSelectedPartyLabel] = useState('');

  const parties = useMemo(
    () => (Array.isArray(canonicalParties) ? canonicalParties : []),
    [canonicalParties],
  );
  const creditors = useMemo(
    () => normalizeCreditors(creditorDigest),
    [creditorDigest],
  );

  const availableRoles = useMemo(() => {
    const roles = new Set();
    for (const party of parties) {
      for (const role of Array.isArray(party?.roles) ? party.roles : []) {
        if (role) roles.add(String(role).toLowerCase());
      }
    }
    return Array.from(roles).sort();
  }, [parties]);

  const filteredParties = useMemo(() => {
    if (!roleFilter) return parties;
    return parties.filter((party) => (
      Array.isArray(party?.roles) && party.roles.some((r) => String(r).toLowerCase() === roleFilter)
    ));
  }, [parties, roleFilter]);

  const {
    facts,
    total,
    loading,
    error,
    filters,
    setFilter,
    resetFilters,
    offset,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
  } = useRunFacts(runId, { limit: 50, enabled: Boolean(runId) });

  const hasActiveFilters = Boolean(
    filters.kind || filters.partyId || filters.grounded !== undefined || (filters.q && filters.q.trim()),
  );

  const hasLegacyParties = useMemo(
    () => Array.isArray(legacyAnalyses)
      && legacyAnalyses.some((a) => Array.isArray(a?.documentParties) && a.documentParties.length > 0),
    [legacyAnalyses],
  );

  // Legacy pre-[R100-026b] fallback when neither canonicalParties nor /facts exist.
  const shouldShowLegacyFallback = parties.length === 0
    && creditors.length === 0
    && !loading
    && !error
    && total === 0
    && !hasActiveFilters
    && hasLegacyParties;

  if (shouldShowLegacyFallback) {
    return (
      <AnalysisDocumentParties
        analyses={legacyAnalyses}
        sourceDocuments={sourceDocuments}
      />
    );
  }

  const handleSelectParty = (partyId, label) => {
    if (!partyId) return;
    if (filters.partyId === partyId) {
      setFilter('partyId', '');
      setSelectedPartyLabel('');
      return;
    }
    setFilter('partyId', partyId);
    setSelectedPartyLabel(label || partyId);
  };

  const handleSelectCreditor = (creditor) => {
    const resolvedPartyId = creditor?.canonicalPartyId
      || (creditor?.oib ? `oib:${creditor.oib}` : '');
    const label = creditor?.creditor || creditor?.name || resolvedPartyId;
    if (resolvedPartyId) {
      handleSelectParty(resolvedPartyId, label);
    } else if (label) {
      setFilter('q', label);
      setSelectedPartyLabel(label);
    }
  };

  const handleClearParty = () => {
    setFilter('partyId', '');
    setSelectedPartyLabel('');
  };

  const handleResetAll = () => {
    setSelectedPartyLabel('');
    resetFilters();
  };

  return (
    <div className="space-y-4" data-testid="entities-explorer">
      {/* Top/Left: Canonical Parties + Top Creditors */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="card p-4 sm:p-5" aria-labelledby="canonical-parties-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow">Kanonski identiteti</p>
              <h2 id="canonical-parties-heading" className="mt-0.5 text-lg font-semibold tracking-tight text-ink">
                Stranke u predmetu
              </h2>
            </div>
            <Badge tone="neutral">{parties.length}</Badge>
          </div>

          {availableRoles.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtriraj stranke po ulozi">
              <button
                type="button"
                onClick={() => setRoleFilter('')}
                aria-pressed={roleFilter === ''}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  roleFilter === ''
                    ? 'border-accent bg-info-surface text-ink'
                    : 'border-line bg-surface-muted text-ink-muted hover:text-ink'
                }`}
              >
                Sve ({parties.length})
              </button>
              {availableRoles.map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleFilter((prev) => (prev === role ? '' : role))}
                  aria-pressed={roleFilter === role}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    roleFilter === role
                      ? 'border-accent bg-info-surface text-ink'
                      : 'border-line bg-surface-muted text-ink-muted hover:text-ink'
                  }`}
                >
                  {formatRoleLabel(role)}
                </button>
              ))}
            </div>
          ) : null}

          {filteredParties.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              {parties.length === 0
                ? 'Kanonske stranke nisu izdvojene za ovaj predmet.'
                : 'Nema stranaka za odabranu ulogu.'}
            </p>
          ) : (
            <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1" data-testid="canonical-parties-list">
              {filteredParties.map((party) => {
                const isSelected = Boolean(party.canonicalPartyId && filters.partyId === party.canonicalPartyId);
                const aliasCount = Array.isArray(party.aliases) ? party.aliases.length : 0;
                const docCount = party.documentCount ?? party.factCount ?? 0;

                return (
                  <li key={party.canonicalPartyId || party.name}>
                    <button
                      type="button"
                      onClick={() => handleSelectParty(party.canonicalPartyId, party.name)}
                      aria-pressed={isSelected}
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? 'border-accent bg-info-surface'
                          : 'border-line bg-surface hover:bg-surface-muted'
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{party.name || party.canonicalPartyId}</p>
                          {party.oib ? (
                            <p className="mt-0.5 font-mono text-xs tabular-nums text-ink-muted">
                              OIB {party.oib}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {aliasCount > 1 ? (
                            <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs tabular-nums text-ink-muted">
                              {aliasCount} naziva
                            </span>
                          ) : null}
                          <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-xs tabular-nums text-ink-muted">
                            {docCount} dok.
                          </span>
                        </div>
                      </div>
                      {Array.isArray(party.roles) && party.roles.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {party.roles.map((role) => (
                            <Badge key={role} tone="neutral" className="px-2 py-0.5 text-xs">
                              {formatRoleLabel(role)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card p-4 sm:p-5" aria-labelledby="top-creditors-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="eyebrow">Stečajne i ovršne tražbine</p>
              <h2 id="top-creditors-heading" className="mt-0.5 text-lg font-semibold tracking-tight text-ink">
                Pregled vjerovnika
              </h2>
            </div>
            {creditors.length > 0 ? <Badge tone="neutral">{creditors.length}</Badge> : null}
          </div>

          {creditors.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">
              Sažetak vjerovnika nije dostupan za ovaj predmet.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm" data-testid="creditor-digest-table">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2 font-medium">Vjerovnik</th>
                    <th className="px-3 py-2 font-medium">Red</th>
                    <th className="px-3 py-2 text-right font-medium">Iznos (EUR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {creditors.map((creditor, index) => {
                    const name = creditor.creditor || creditor.name || 'Nepoznat vjerovnik';
                    const isSelected = Boolean(
                      creditor.canonicalPartyId && filters.partyId === creditor.canonicalPartyId,
                    );
                    const hasLifecycle = Boolean(
                      creditor.cession || creditor.ustup || creditor.lifecycleEvents?.length > 0 || creditor.eventType === 'ustup',
                    );
                    const totalEur = typeof creditor.totalEur === 'number'
                      ? creditor.totalEur
                      : (typeof creditor.amountEur === 'number' ? creditor.amountEur : null);

                    return (
                      <tr
                        key={`${creditor.canonicalPartyId || name}-${index}`}
                        className={isSelected ? 'bg-info-surface' : 'hover:bg-surface-muted/60'}
                      >
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleSelectCreditor(creditor)}
                            className="text-left font-medium text-ink hover:text-accent hover:underline"
                          >
                            {name}
                          </button>
                          {hasLifecycle ? (
                            <span className="ml-2 inline-block rounded-full border border-line bg-warning-surface px-2 py-0.5 text-xs text-warning">
                              Ustup / prijenos
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-muted">
                          {creditor.isplatniRed || '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                          {totalEur !== null ? formatEur(totalEur) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Bottom/Right: Cross-Filtered Facts Ledger */}
      <section className="card p-4 sm:p-5" aria-labelledby="facts-ledger-heading" data-testid="facts-ledger-section">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Knjiga činjenica</p>
            <h2 id="facts-ledger-heading" className="mt-0.5 text-lg font-semibold tracking-tight text-ink">
              Izdvojene činjenice po strankama
            </h2>
          </div>
          <span className="text-xs tabular-nums text-ink-muted">
            Ukupno: {total}
          </span>
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vrsta činjenice">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value || 'all'}
                type="button"
                onClick={() => setFilter('kind', option.value)}
                aria-pressed={filters.kind === option.value}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  filters.kind === option.value
                    ? 'border-accent bg-info-surface text-ink'
                    : 'border-line bg-surface-muted text-ink-muted hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setFilter('grounded', filters.grounded === true ? undefined : true)}
            aria-pressed={filters.grounded === true}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              filters.grounded === true
                ? 'border-accent bg-info-surface text-ink'
                : 'border-line bg-surface-muted text-ink-muted hover:text-ink'
            }`}
          >
            Samo potvrđeno
          </button>

          <div className="min-w-[12rem] flex-1">
            <Input
              type="search"
              value={filters.q}
              onChange={(e) => setFilter('q', e.target.value)}
              placeholder="Filtriraj činjenice po opisu…"
              aria-label="Pretraga činjenica"
            />
          </div>

          {hasActiveFilters ? (
            <Button variant="ghost" size="sm" onClick={handleResetAll}>
              Očisti filtere
            </Button>
          ) : null}
        </div>

        {filters.partyId ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-accent bg-info-surface px-3 py-1 text-xs font-medium text-ink">
              Stranka: {selectedPartyLabel || filters.partyId}
              <button
                type="button"
                onClick={handleClearParty}
                aria-label="Ukloni filter stranke"
                className="font-semibold text-ink-muted hover:text-ink"
              >
                ×
              </button>
            </span>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4 space-y-2" aria-busy="true" aria-label="Učitavanje činjenica">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="rounded-lg border border-line p-3">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton mt-2 h-3.5 w-full" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="mt-4">
            <Callout tone="danger" glyph="!" alert title="Činjenice nije moguće učitati">
              {error}
            </Callout>
          </div>
        ) : facts.length === 0 ? (
          <div className="mt-4 rounded-md border border-line bg-surface-muted/40 px-4 py-6 text-center">
            <p className="text-sm text-ink-muted">
              {hasActiveFilters
                ? 'Nema činjenica koje odgovaraju odabranim filterima.'
                : 'Nema zabilježenih činjenica za ovu analizu.'}
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2.5">
            <ul className="space-y-2" data-testid="facts-ledger-list">
              {facts.map((fact) => {
                const quote = fact.quote || fact.raw?.quote || null;
                const canOpenEvidence = Boolean(onOpenEvidence && fact.sourceChunkId);

                return (
                  <li
                    key={fact.id}
                    className="rounded-lg border border-line bg-surface p-3.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral" className="px-2 py-0.5 text-xs">
                          {KIND_LABELS[fact.kind] || fact.kind}
                        </Badge>
                        {fact.date ? (
                          <span className="text-xs tabular-nums text-ink-muted">
                            {formatDate(fact.date)}
                          </span>
                        ) : null}
                        {fact.grounded === false ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-warning-surface px-2 py-0.5 text-xs text-warning"
                            data-testid="fact-unverified-badge"
                          >
                            ⚠ nepotvrđeno
                          </span>
                        ) : null}
                      </div>
                      <span className="font-mono text-sm font-medium tabular-nums text-ink">
                        {formatFactAmount(fact)}
                      </span>
                    </div>

                    <p className="mt-1.5 text-sm leading-relaxed text-ink">
                      {fact.description || '—'}
                    </p>

                    {canOpenEvidence ? (
                      <div className="mt-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onOpenEvidence({
                            chunkId: fact.sourceChunkId,
                            docId: fact.docId,
                            quote,
                            pageNumbers: fact.sourcePages,
                            sourceStartIndex: fact.sourceStartIndex,
                            sourceEndIndex: fact.sourceEndIndex,
                          })}
                        >
                          Prikaži u kontekstu
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {hasPrev || hasNext ? (
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-xs tabular-nums text-ink-muted">
                  Prikaz {offset + 1}–{offset + facts.length} od {total}
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={prevPage} disabled={!hasPrev}>
                    Prethodna
                  </Button>
                  <Button variant="secondary" size="sm" onClick={nextPage} disabled={!hasNext}>
                    Sljedeća
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
