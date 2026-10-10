import { useMemo, useState } from 'react';
import { profileLabel, LAB_PROFILE_ORDER } from './labMeta';
const NODE_KIND_LABELS = {
  'claim-thread': 'Povezana grupa tražbina',
  'property-thread': 'Povezana grupa imovine',
  unresolved: 'Činjenica ostavljena odvojeno',
  'procedural-period': 'Činjenice iz razdoblja',
  'case-root': 'Pregled predmeta',
};

const nodeKindLabel = (kind) => NODE_KIND_LABELS[kind] || 'Grupa činjenica';
const factCountLabel = (count) => {
  if (count === 1) return '1 činjenica';
  if (count >= 2 && count <= 4) return `${count} činjenice`;
  return `${count} činjenica`;
};

const ungroundedFactCount = (coverage) => {
  if (Number.isInteger(coverage?.ungroundedFactCount)) return coverage.ungroundedFactCount;
  if (Array.isArray(coverage?.gaps)) {
    return coverage.gaps.filter((gap) => String(gap).startsWith('ungrounded:')).length;
  }
  if (Number.isInteger(coverage?.totalClaims) && Number.isInteger(coverage?.groundedClaims)) {
    return Math.max(0, coverage.totalClaims - coverage.groundedClaims);
  }
  return 0;
};

const citationMismatchLabel = (count) => {
  const facts = count === 1 ? '1 činjenicu' : count >= 2 && count <= 4 ? `${count} činjenice` : `${count} činjenica`;
  return `Za ${facts} nije bilo moguće pronaći pouzdano podudaranje citata s tekstom izvora.`;
};

const summaryReasonLabel = (reason) => ({
  'call-failed': 'Poziv za izradu sažetka nije uspio.',
  'invalid-summary': 'Odgovor nije imao prihvatljiv format ili poveznice na prepoznate izvore.',
  'node-budget-exhausted': 'Dosegnuta je granica broja sažetaka; izvorne činjenice ostaju dostupne.',
  'summaries-unavailable': 'Sažeci nisu uključeni za ovu varijantu.',
  'empty-packet': 'Nije bilo dovoljno izvornih činjenica za sažetak.',
  'ineligible-kind': 'Ova vrsta grupe ne dobiva automatski sažetak.',
}[reason] || 'Razlog nije zabilježen.');

const omissionReasonLabel = (reason) => ({
  'context-node-budget-exhausted': 'Tema nije uključena jer je dosegnuta granica broja tema za ovu varijantu.',
  'node-budget-exhausted': 'Sažetak nije izrađen jer je dosegnuta granica broja sažetaka.',
  'unresolvable-citation': 'Sažeti zaključak nije uključen jer se nije mogao povezati s izvornim dokumentom.',
}[reason] || 'Stavka nije uključena; razlog nije zabilježen.');

function groupOmissions(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = entry?.reason || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.entries()].map(([reason, items]) => ({ reason, items }));
}

function omissionCountLabel(count, singular, paucal, plural) {
  if (count === 1) return `1 ${singular}`;
  if (count >= 2 && count <= 4) return `${count} ${paucal}`;
  return `${count} ${plural}`;
}

function OmissionGroup({ group, kind }) {
  const count = group.items.length;
  const subject = kind === 'topic'
    ? omissionCountLabel(count, 'tematska grupa nije uključena', 'tematske grupe nisu uključene', 'tematskih grupa nije uključeno')
    : kind === 'summary'
      ? omissionCountLabel(count, 'sažetak nije izrađen', 'sažetka nisu izrađena', 'sažetaka nije izrađeno')
      : omissionCountLabel(count, 'sažeti zaključak nije uključen', 'sažeta zaključka nisu uključena', 'sažetih zaključaka nije uključeno');
  return (
    <li className="text-[var(--text)]">
      <p>{subject}.</p>
      <p className="mt-0.5 text-[var(--text-muted)]">{omissionReasonLabel(group.reason)}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2">
          Tehnički zapisi ({count})
        </summary>
        <ul className="mt-1 space-y-1 break-words font-mono text-xs text-[var(--text-muted)]">
          {group.items.map((entry, index) => (
            <li key={`${entry.nodeId || entry.factId || group.reason}-${index}`}>
              {entry.nodeId && <span>ID teme: {entry.nodeId} · </span>}
              {entry.factId && <span>ID činjenice: {entry.factId} · </span>}
              {entry.reason && <span>Razlog: {entry.reason} · </span>}
              {entry.detail || 'Bez dodatnih pojedinosti.'}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

const unavailable = (label) => (
  <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--text-muted)]">
    {label}: nedostupno.
  </p>
);

const idList = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return <span className="text-[var(--text-muted)]">—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <li key={String(id)} className="rounded bg-[var(--surface-muted)] px-1.5 py-0.5 font-mono text-xs text-[var(--text)]">
          {String(id)}
        </li>
      ))}
    </ul>
  );
};
function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function indexSourceDocuments(sourceDocuments) {
  const byId = new Map();
  for (const document of Array.isArray(sourceDocuments) ? sourceDocuments : []) {
    const source = { ...document, url: safeSourceUrl(document?.url) };
    if (source.analysisId) byId.set(source.analysisId, source);
    if (source.sourceDocumentLinkId) byId.set(source.sourceDocumentLinkId, source);
  }
  return byId;
}

function SourceDocumentLink({ document, compact = false }) {
  const name = document?.fileName || 'Izvorni dokument';
  if (!document?.url) {
    return <span className="text-xs text-[var(--text-muted)]">Izvorna datoteka nije povezana · {name}</span>;
  }
  return (
    <a
      href={document.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 font-medium text-[var(--accent)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 ${compact ? 'text-xs' : 'text-sm'}`}
    >
      Otvori izvorni dokument · {name}<span aria-hidden="true">↗</span>
    </a>
  );
}

function collectDoubtfulSources(trace, isFlat, sourceDocumentsById) {
  const sources = new Map();
  const add = (sourceId, fileName, reason) => {
    const document = sourceDocumentsById.get(sourceId) || {
      analysisId: sourceId || null,
      fileName: fileName || null,
      url: null,
    };
    const key = sourceId || document.analysisId || document.fileName;
    if (!key) return;
    if (!sources.has(key)) sources.set(key, { document, reasons: new Set() });
    const item = sources.get(key);
    if (!item.document.fileName && fileName) item.document.fileName = fileName;
    item.reasons.add(reason);
  };

  const fragments = trace?.fragments || {};
  if (isFlat) {
    for (const claim of fragments?.flatClaims?.claims || []) {
      for (const evidence of claim?.evidence || []) {
        if (evidence?.grounded === true && evidence?.text) continue;
        const reason = evidence?.grounded === false
          ? 'izvadak nije potvrđen u izvorniku'
          : !evidence?.text
            ? 'izvadak nedostaje'
            : 'provjera izvornika nije zabilježena';
        add(evidence?.sourceId, evidence?.fileName, reason);
      }
    }
  } else {
    for (const node of fragments?.contextNodes || []) {
      const facts = Array.isArray(node?.facts) ? node.facts : [];
      for (const fact of facts) {
        if (fact?.grounded === true && fact?.excerpt) continue;
        const reason = fact?.grounded === false
          ? 'činjenica nije potvrđena u izvorniku'
          : !fact?.excerpt
            ? 'izvadak nedostaje'
            : 'provjera izvornika nije zabilježena';
        add(fact?.sourceId, fact?.fileName, reason);
      }
      for (const summary of node?.summary || []) {
        for (const sourceId of summary?.sourceDocumentIds || []) {
          add(sourceId, null, 'izvedeni sažetak — provjerite izvor');
        }
      }
    }
  }

  return [...sources.values()].map(({ document, reasons }) => ({
    document,
    reason: [...reasons].join(' · '),
  }));
}

function SourceReviewNudge({ sources, sourceDocumentsStatus }) {
  if (sources.length === 0) return null;
  return (
    <section
      aria-labelledby="lab-source-review-heading"
      className="mt-4 border-l-4 border-[var(--warning)] bg-[var(--surface-muted)] px-4 py-3"
      data-testid="lab-source-review"
    >
      <h3 id="lab-source-review-heading" className="text-sm font-semibold text-[var(--text)]">
        Izvori za provjeru · {sources.length} {sources.length === 1 ? 'dokument' : 'dokumenata'}
      </h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Izvadak nedostaje ili nije potvrđen, ili se dokument koristi kao izvor za sažetak.
        Sažetak sam po sebi nije dokaz; otvorite izvornu datoteku za provjeru.
      </p>
      {sourceDocumentsStatus === 'package-changed' ? (
        <p className="mt-1 text-xs font-medium text-[var(--warning)]">Izvorni paket više ne odgovara snimci ovog eksperimenta.</p>
      ) : null}
      <ul className="mt-2 space-y-2">
        {sources.slice(0, 12).map(({ document, reason }, index) => (
          <li key={document.analysisId || document.fileName || index} className="flex flex-col gap-0.5">
            <SourceDocumentLink document={document} />
            <span className="text-xs text-[var(--text-muted)]">{reason}</span>
          </li>
        ))}
        {sources.length > 12 ? (
          <li className="text-xs text-[var(--text-muted)]">Još {sources.length - 12} izvora imaju otvorene provjere.</li>
        ) : null}
      </ul>
    </section>
  );
}

function sourceDocumentFor(sourceDocumentsById, sourceId, fileName) {
  return sourceDocumentsById.get(sourceId) || {
    analysisId: sourceId || null,
    fileName: fileName || null,
    url: null,
  };
}


function NodeDetail({ node, fragment, outcome, summariesEnabled, dagSelections, sourceDocumentsById }) {
  const selectionReasons = useMemo(() => {
    if (!Array.isArray(dagSelections)) return [];
    return dagSelections.filter((entry) => entry?.nodeId === node?.nodeId);
  }, [dagSelections, node]);

  if (!node) {
    return <p className="text-sm text-[var(--text-muted)]">Odaberite grupu ili činjenicu s popisa.</p>;
  }

  const factCount = Number.isInteger(fragment?.coverage?.totalClaims)
    ? fragment.coverage.totalClaims
    : Array.isArray(node.factIds) ? node.factIds.length : 0;
  const unverifiedCount = ungroundedFactCount(fragment?.coverage);
  const unverifiedFacts = Array.isArray(fragment?.ungroundedFacts)
    ? fragment.ungroundedFacts
    : (fragment?.facts || []).filter((fact) => fact?.grounded === false);
  const unverifiedDetailsOmitted = Number.isInteger(fragment?.ungroundedFactDetailsOmittedCount)
    ? fragment.ungroundedFactDetailsOmittedCount
    : Math.max(0, unverifiedCount - unverifiedFacts.length);
  const omittedExcerptCount = Number.isInteger(fragment?.omittedFactCount)
    ? fragment.omittedFactCount
    : Math.max(0, factCount - (fragment?.facts?.length || 0));
  const title = fragment?.title || nodeKindLabel(node.kind);

  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {nodeKindLabel(node.kind)} · {factCountLabel(factCount)}
      </p>
      <h3 className="mt-1 text-xl font-semibold text-[var(--text)]">{title}</h3>

      {node.kind === 'unresolved' && (
        <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text)]">
          Nije pronađen broj prijave tražbine ili oznaka podneska za sigurno povezivanje.
          Zato je ova činjenica ostavljena odvojeno, umjesto da se nagađa kojoj temi pripada.
        </p>
      )}

      <div className="mt-4 space-y-4 text-sm">
        {fragment?.coverage && node.kind !== 'unresolved' && (
          <section>
            <h4 className="font-semibold text-[var(--text)]">Automatska provjera citata</h4>
            <p className="mt-1 text-[var(--text)]">
              Citati koji se podudaraju s tekstom izvora: {fragment.coverage.groundedClaims ?? '?'} / {factCount || 'nepoznato'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Automatska provjera podudaranja teksta; ne ocjenjuje je li činjenica točna.
            </p>
            {unverifiedCount > 0 ? (
              <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <p className="font-medium text-[var(--text)]">{citationMismatchLabel(unverifiedCount)}</p>
                {unverifiedFacts.length > 0 ? (
                  <details className="mt-1">
                    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2">
                      Prikaži stavke za provjeru ({unverifiedFacts.length} od {unverifiedCount})
                    </summary>
                    <ul className="space-y-3">
                      {unverifiedFacts.map((fact) => (
                        <li key={fact.factId} className="border-t border-[var(--border)] pt-2">
                          <p className="font-medium text-[var(--text)]">
                            {fact.fileName || 'Izvorni dokument nije dostupan'}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[var(--text)]">
                            {fact.quoteProvided === false
                              ? `Citat nije dostupan. Izdvojeni opis: ${fact.excerpt || 'nije dostupan.'}`
                              : fact.excerpt || 'Citirani odlomak nije dostupan u ovoj snimci.'}
                          </p>
                          <SourceDocumentLink
                            document={sourceDocumentFor(sourceDocumentsById, fact.sourceId, fact.fileName)}
                            compact
                          />
                        </li>
                      ))}
                    </ul>
                    {unverifiedDetailsOmitted > 0 && (
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        Još {unverifiedDetailsOmitted} stavki nema pojedinosti u ovoj snimci.
                      </p>
                    )}
                  </details>
                ) : (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Pojedinosti o tim citatima nisu sačuvane u ovoj snimci.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-[var(--text-muted)]">Svi prikazani citati podudaraju se s tekstom izvora.</p>
            )}
          </section>
        )}

        {Array.isArray(fragment?.summary) && fragment.summary.length > 0 && (
          <section>
            <h4 className="font-semibold text-[var(--text)]">Sažetak za kontekst · nije dokaz</h4>
            <ul className="mt-2 space-y-2">
              {fragment.summary.map((statement, index) => (
                <li key={`${node.nodeId}-summary-${index}`} className="rounded-lg border border-dashed border-[var(--border)] p-3">
                  <p className="whitespace-pre-wrap text-[var(--text)]">{statement.text || 'Tekst sažetka nije dostupan.'}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Sažetak je sastavljen radi konteksta. Njegove poveznice vode na poznate izvore, ali to samo po sebi ne potvrđuje sadržaj — provjerite izvorni odlomak.</p>
                  {statement.sourceDocumentIds?.map((sourceId) => (
                    <div key={`${node.nodeId}-${sourceId}`} className="mt-2">
                      <SourceDocumentLink document={sourceDocumentFor(sourceDocumentsById, sourceId)} compact />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}

        {Array.isArray(fragment?.facts) && fragment.facts.length > 0 && (
          <section>
            <h4 className="font-semibold text-[var(--text)]">Izvorni odlomci ({fragment.facts.length} od {factCount})</h4>
            <ul className="mt-2 space-y-2">
              {fragment.facts.map((fact) => (
                <li key={fact.factId} className="rounded-lg bg-[var(--surface-muted)] p-3">
                  <p className="font-mono text-xs text-[var(--text-muted)]">
                    {fact.fileName || 'Izvorni dokument nije dostupan'}{fact.date ? ` · ${fact.date}` : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--text)]">{fact.excerpt || 'Izvadak nije dostupan.'}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {fact.grounded === true
                      ? 'Izvadak pronađen u izvornom tekstu.'
                      : fact.grounded === false
                        ? 'Izvadak nije potvrđen u izvornom tekstu.'
                        : 'Provjera izvornog teksta nije zabilježena.'}
                  </p>
                  <SourceDocumentLink
                    document={sourceDocumentFor(sourceDocumentsById, fact.sourceId, fact.fileName)}
                    compact
                  />
                </li>
              ))}
            </ul>
            {omittedExcerptCount > 0 && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Još {omittedExcerptCount} izvornih činjenica nije prikazano u ovom popisu.
              </p>
            )}
          </section>
        )}

        {summariesEnabled !== true ? (
          <p className="rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--text-muted)]">
            Ova varijanta ne izrađuje zasebne sažetke po temi; koristi izvorne činjenice iznad.
          </p>
        ) : outcome ? (
          <section className="rounded-lg border border-[var(--border)] p-3">
            <h4 className="font-semibold text-[var(--text)]">Ishod sažetka</h4>
            <p className="mt-1 text-[var(--text)]">
              {outcome.status === 'complete'
                ? 'Sažetak je prihvaćen uz prepoznatljive poveznice na izvore.'
                : outcome.reason === 'invalid-summary'
                  ? 'Automatski sažetak nije prihvaćen.'
                  : 'Sažetak nije izrađen; izvorne činjenice iznad ostaju dostupne.'}
            </p>
            {outcome.reason && <p className="mt-1 text-[var(--text-muted)]">{summaryReasonLabel(outcome.reason)}</p>}
            {outcome.reason === 'invalid-summary' && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Izvorni odlomci iznad i njihova provjera ostaju zasebni; odbijanje sažetka ne znači da ti odlomci nisu potvrđeni.
              </p>
            )}
          </section>
        ) : (
          <p className="rounded-lg border border-dashed border-[var(--border)] p-3 text-sm text-[var(--text-muted)]">
            Ishod izrade sažetka nije zabilježen.
          </p>
        )}

        {(node.nodeId || node.factIds?.length || fragment?.sourceDocumentIds?.length || fragment?.citationIds?.length || selectionReasons.length > 0) && (
          <details className="border-t border-[var(--border)] pt-3">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2">
              Tehnički podaci i identifikatori
            </summary>
            <div className="space-y-2 text-xs text-[var(--text-muted)]">
              {node.nodeId && <p>ID teme: <code className="break-all">{node.nodeId}</code></p>}
              <div>Interni ID-jevi činjenica: {idList(node.factIds)}</div>
              <div>Interni ID-jevi dokumenata: {idList(fragment?.sourceDocumentIds || node.sourceDocumentIds)}</div>
              <div>Oznake citata: {idList(fragment?.citationIds || node.citationIds)}</div>
              {selectionReasons.length > 0 && (
                <div>
                  Razlog uključivanja u ovu varijantu:
                  <ul className="mt-1 list-disc pl-5">
                    {selectionReasons.map((entry, index) => (
                      <li key={`sel-${index}`}>{entry.reason || entry.basis || 'nije zabilježen'}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

function FlatClaimDetail({ claim, sourceDocumentsById }) {
  if (!claim) return <p className="text-sm text-[var(--text-muted)]">Odaberite nalaz s popisa.</p>;
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Nalaz izrađen izravno iz izvornih činjenica</p>
      <h3 className="mt-1 text-lg font-semibold text-[var(--text)]">Nalaz</h3>
      <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--text)]">{claim.text || 'Tekst nalaza nije dostupan.'}</p>
      {claim.evidence?.length ? (
        <section className="mt-4">
          <h4 className="font-semibold text-[var(--text)]">Izvorni odlomci</h4>
          <ul className="mt-2 space-y-2">
            {claim.evidence.map((entry, index) => (
              <li key={`${claim.claimId}-${entry.sourceId || index}`} className="rounded-lg bg-[var(--surface-muted)] p-3">
                <p className="font-mono text-xs text-[var(--text-muted)]">{entry.fileName || 'Izvorni dokument nije dostupan'}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">{entry.text || 'Izvadak nije dostupan.'}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {entry.grounded === true
                    ? 'Izvadak pronađen u izvornom tekstu.'
                    : entry.grounded === false
                      ? 'Izvadak nije potvrđen u izvornom tekstu.'
                      : 'Provjera izvornog teksta nije zabilježena.'}
                </p>
                <SourceDocumentLink
                  document={sourceDocumentFor(sourceDocumentsById, entry.sourceId, entry.fileName)}
                  compact
                />
              </li>
            ))}
          </ul>
        </section>
      ) : unavailable('Izvorni odlomci za ovaj nalaz')}
      {claim.claimId && (
        <details className="mt-4 border-t border-[var(--border)] pt-3">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2">
            Tehnički ID nalaza
          </summary>
          <code className="text-xs text-[var(--text-muted)]">{claim.claimId}</code>
        </details>
      )}
    </div>
  );
}

export default function LabFragmentsPane({ variants, activeProfile, onProfileChange, sourceDocuments, sourceDocumentsStatus }) {
  const order = LAB_PROFILE_ORDER.filter((profileId) => variants?.[profileId]);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedFlatClaimId, setSelectedFlatClaimId] = useState(null);

  const active = variants?.[activeProfile] || null;
  const trace = active?.trace && typeof active.trace === 'object' ? active.trace : null;
  const isFlat = !trace || trace.baseline === true || trace.strategy === 'flat';
  const nodes = Array.isArray(trace?.selection?.selected) ? trace.selection.selected : [];
  const fragments = trace?.fragments && typeof trace.fragments === 'object' ? trace.fragments : null;
  const flatClaims = Array.isArray(fragments?.flatClaims?.claims) ? fragments.flatClaims.claims : [];
  const contextNodes = Array.isArray(fragments?.contextNodes) ? fragments.contextNodes : [];
  const omitted = Array.isArray(trace?.selection?.omitted) ? trace.selection.omitted : [];
  const summaries = trace?.summaries && typeof trace.summaries === 'object' ? trace.summaries : null;
  const outcomes = Array.isArray(summaries?.outcomes) ? summaries.outcomes : [];
  const summaryOmitted = Array.isArray(summaries?.omitted) ? summaries.omitted : [];
  const droppedDerived = Array.isArray(summaries?.droppedDerived) ? summaries.droppedDerived : [];
  const topicOmissions = groupOmissions(omitted);
  const summaryOmissions = groupOmissions(summaryOmitted);
  const droppedSummaryClaims = groupOmissions(droppedDerived);
  const outcomeByNode = useMemo(() => {
    const map = new Map();
    for (const outcome of outcomes) {
      if (outcome?.nodeId) map.set(outcome.nodeId, outcome);
    }
    return map;
  }, [outcomes]);
  const selectedNode = nodes.find((node) => node?.nodeId === selectedNodeId) || nodes[0] || null;
  const selectedFlatClaim = flatClaims.find((claim) => claim?.claimId === selectedFlatClaimId) || flatClaims[0] || null;
  const contextFragmentByNode = useMemo(() => new Map(contextNodes.map((node) => [node.nodeId, node])), [contextNodes]);
  const usage = active?.usage && typeof active.usage === 'object' ? active.usage : null;
  const snapshot = active?.profileSnapshot && typeof active.profileSnapshot === 'object' ? active.profileSnapshot : null;
  const sourceDocumentsById = useMemo(() => indexSourceDocuments(sourceDocuments), [sourceDocuments]);
  const reviewSources = useMemo(
    () => collectDoubtfulSources(trace, isFlat, sourceDocumentsById),
    [trace, isFlat, sourceDocumentsById]
  );

  const selectProfile = (profileId) => {
    setSelectedNodeId(null);
    setSelectedFlatClaimId(null);
    onProfileChange?.(profileId);
  };

  return (
    <div>
      <div role="group" aria-label="Odaberi varijantu za fragmente" className="flex flex-wrap gap-2">
        {order.map((profileId) => (
          <button
            key={profileId}
            type="button"
            onClick={() => selectProfile(profileId)}
            aria-pressed={profileId === activeProfile}
            className={`rounded-lg border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${
              profileId === activeProfile
                ? 'border-[var(--text)] bg-[var(--text)] text-[var(--surface)]'
                : 'border-[var(--border)] text-[var(--text)] hover:bg-[var(--surface-muted)]'
            }`}
          >
            {profileLabel(profileId)}
          </button>
        ))}
      </div>
      <SourceReviewNudge sources={reviewSources} sourceDocumentsStatus={sourceDocumentsStatus} />

      {!active || active.status === 'error' ? (
        <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Fragmenti nisu dostupni — varijanta {profileLabel(activeProfile)} nije uspjela.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_minmax(0,20rem)]">
          <aside aria-label="Teme i odvojene činjenice" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <h3 className="border-b border-[var(--border)] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
              {isFlat ? 'Bez tematskog grupiranja' : `Teme i činjenice · ${profileLabel(activeProfile)}`}
            </h3>
            <p className="px-3 py-2 text-xs text-[var(--text-muted)]">
              Odaberite stavku da biste vidjeli izvorne odlomke i što treba provjeriti.
            </p>
            <div className="max-h-96 overflow-y-auto p-2">
              {isFlat ? (
                <div className="space-y-2 p-1 text-sm">
                  <p className="text-[var(--text)]">
                    Ravni profil šalje izdvojene tvrdnje izravno u izvještaj, bez grupiranja po temama.
                  </p>
                  {flatClaims.length === 0 ? unavailable('Popis odabranih tvrdnji') : (
                    <ul className="space-y-1">
                      {flatClaims.map((claim, index) => (
                        <li key={claim.claimId || `claim-${index}`}>
                          <button type="button" onClick={() => setSelectedFlatClaimId(claim.claimId)}
                            aria-current={(claim.claimId || null) === (selectedFlatClaim?.claimId || null) ? 'true' : undefined}
                            className="w-full rounded-lg border-l-2 border-l-transparent px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2">
                            <span className="block text-xs text-[var(--text-muted)]">Nalaz {index + 1}</span>
                            <span className="block truncate">{claim.text || 'Tekst nije dostupan.'}</span>
                          </button>
                        </li>
                      ))}
                      {fragments?.flatClaims?.omittedCount > 0 && <li className="p-2 text-xs text-[var(--text-muted)]">Još {fragments.flatClaims.omittedCount} tvrdnji nije prikazano.</li>}
                    </ul>
                  )}
                </div>
              ) : nodes.length === 0 ? (
                <p className="p-2 text-sm text-[var(--text-muted)]">Ova varijanta nema tematskih grupa za prikaz.</p>
              ) : (
                <ul className="space-y-1">
                  {nodes.map((node, index) => {
                    const isActive = node?.nodeId === selectedNode?.nodeId;
                    const outcome = outcomeByNode.get(node?.nodeId);
                    return (
                      <li key={node?.nodeId || `node-${index}`}>
                        <button
                          type="button"
                          onClick={() => setSelectedNodeId(node?.nodeId)}
                          aria-current={isActive ? 'true' : undefined}
                          className={`w-full rounded-lg border-l-2 px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 ${
                            isActive
                              ? 'border-l-[var(--text)] bg-[var(--surface-muted)]'
                              : 'border-l-transparent hover:bg-[var(--surface-muted)]'
                          }`}
                        >
                          <span className="block text-xs text-[var(--text-muted)]">
                            {nodeKindLabel(node?.kind)} · {factCountLabel(Number.isInteger(contextFragmentByNode.get(node?.nodeId)?.coverage?.totalClaims)
                              ? contextFragmentByNode.get(node?.nodeId).coverage.totalClaims
                              : (node?.factIds || []).length)}
                          </span>
                          <span className="block truncate text-sm font-medium text-[var(--text)]">
                            {contextFragmentByNode.get(node?.nodeId)?.title
                              || contextFragmentByNode.get(node?.nodeId)?.facts?.[0]?.description
                              || nodeKindLabel(node?.kind)}
                          </span>
                          {outcome && (
                            <span className="mt-0.5 inline-block text-xs text-[var(--text-muted)]">
                              {outcome.status === 'complete'
                                ? 'Sažetak prihvaćen'
                                : outcome.reason === 'invalid-summary'
                                  ? 'Sažetak nije prihvaćen'
                                  : 'Sažetak nije izrađen'}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>

          <article aria-label="Detalj fragmenta" aria-live="polite" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {isFlat ? (
              <FlatClaimDetail claim={selectedFlatClaim} sourceDocumentsById={sourceDocumentsById} />
            ) : (
              <NodeDetail
                node={selectedNode}
                fragment={selectedNode ? contextFragmentByNode.get(selectedNode.nodeId) : null}
                outcome={selectedNode ? outcomeByNode.get(selectedNode.nodeId) : null}
                summariesEnabled={summaries?.enabled === true}
                dagSelections={trace?.dag?.selections}
                sourceDocumentsById={sourceDocumentsById}
              />
            )}
          </article>

          <aside aria-label="Detalji obrade" className="space-y-4">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">Što ova varijanta nije uključila</h3>
              {topicOmissions.length === 0 && summaryOmissions.length === 0 && droppedSummaryClaims.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">Nema izostavljenih tema ni sažetaka.</p>
              ) : (
                <ul className="mt-2 space-y-4 text-sm">
                  {topicOmissions.map((group) => <OmissionGroup key={`topic-${group.reason}`} group={group} kind="topic" />)}
                  {summaryOmissions.map((group) => <OmissionGroup key={`summary-${group.reason}`} group={group} kind="summary" />)}
                  {droppedSummaryClaims.map((group) => <OmissionGroup key={`derived-${group.reason}`} group={group} kind="derived" />)}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">Resursi korišteni</h3>
              {usage ? (
                <dl className="mt-2 space-y-1 text-sm text-[var(--text)]">
                  <div className="flex justify-between gap-2"><dt>Pozivi AI modelu</dt><dd className="tabular-nums">{usage.calls ?? 'Nepoznato'}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Tokeni obrađeni</dt><dd className="tabular-nums">{usage.totalTokens ?? 'Nepoznato'}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Trajanje</dt><dd className="tabular-nums">{usage.elapsedMs != null ? `${(usage.elapsedMs / 1000).toFixed(1)} s` : 'Nepoznato'}</dd></div>
                </dl>
              ) : (
                unavailable('Resursi')
              )}
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">Postavke metode</h3>
              {snapshot ? (
                <>
                  <dl className="mt-2 space-y-1 text-sm text-[var(--text)]">
                    <div className="flex justify-between gap-2">
                      <dt>Način organiziranja</dt>
                      <dd>{snapshot.contextStrategy === 'case-context' ? 'Tematske grupe' : snapshot.contextStrategy === 'flat' ? 'Bez grupiranja' : 'Nepoznato'}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Sažeci po temi</dt>
                      <dd>{snapshot.nodeSummaries === 'on' ? 'Uključeni' : snapshot.nodeSummaries === 'off' ? 'Isključeni' : 'Nepoznato'}</dd>
                    </div>
                  </dl>
                  {snapshot.codeRevision && (
                    <details className="mt-2 border-t border-[var(--border)] pt-2">
                      <summary className="cursor-pointer text-xs text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2">
                        Tehnička revizija
                      </summary>
                      <code className="mt-1 block break-all text-xs text-[var(--text-muted)]">{snapshot.codeRevision}</code>
                    </details>
                  )}
                </>
              ) : (
                unavailable('Postavke metode')
              )}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
