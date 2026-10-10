import { useMemo, useState } from 'react';
import { profileLabel, LAB_PROFILE_ORDER } from './labMeta';

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
      if ((node?.coverage?.gaps || []).length > 0 || node?.status === 'unresolved') {
        for (const sourceId of node?.sourceDocumentIds || []) {
          add(sourceId, null, 'praznina ili nerazriješena veza u ovom čvoru');
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
        Provjerite izvor · {sources.length} {sources.length === 1 ? 'dokument' : 'dokumenata'}
      </h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Ove stavke imaju neprovjeren izvadak, nedostajući dokaz ili izvedeni sažetak.
        Pregledajte izvornu datoteku prije nego što ih tretirate kao potvrđene.
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


function NodeDetail({ node, fragment, outcome, dagSelections, sourceDocumentsById }) {
  const selectionReasons = useMemo(() => {
    if (!Array.isArray(dagSelections)) return [];
    return dagSelections.filter((entry) => entry?.nodeId === node?.nodeId);
  }, [dagSelections, node]);

  if (!node) {
    return <p className="text-sm text-[var(--text-muted)]">Odaberite čvor s popisa.</p>;
  }

  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {node.kind || 'nepoznata vrsta'} · {node.nodeId}
      </p>
      <h3 className="mt-1 text-xl font-semibold text-[var(--text)]">{node.nodeId}</h3>

      <div className="mt-4 space-y-3 text-sm">
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Činjenice</h4>
          <div className="mt-1">{idList(node.factIds)}</div>
        </div>
        <div>
          <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Izvorni dokumenti i citati</h4>
          <div className="mt-1 space-y-2">
            <div><span className="text-[var(--text-muted)]">Dokumenti: </span>{idList(fragment?.sourceDocumentIds || node.sourceDocumentIds)}</div>
            <div><span className="text-[var(--text-muted)]">Citati: </span>{idList(fragment?.citationIds || node.citationIds)}</div>
          </div>
        </div>
        {fragment?.coverage && (
          <div>
            <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Pokrivenost</h4>
            <p className="mt-1 text-[var(--text)]">Uzemljeno {fragment.coverage.groundedClaims ?? '?'} / {fragment.coverage.totalClaims ?? '?'}</p>
            {Array.isArray(fragment.coverage.gaps) && fragment.coverage.gaps.length > 0
              ? <ul className="mt-1 list-disc pl-5 text-[var(--text-muted)]">{fragment.coverage.gaps.map((gap, index) => <li key={`${node.nodeId}-gap-${index}`}>{String(gap)}</li>)}</ul>
              : <p className="mt-1 text-[var(--text-muted)]">Nema zabilježenih praznina.</p>}
          </div>
        )}
        {Array.isArray(fragment?.summary) && fragment.summary.length > 0 && (
          <div>
            <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Izvedeni sažeci · kontekst, ne dokaz</h4>
            <ul className="mt-2 space-y-2">
              {fragment.summary.map((statement, index) => (
                <li key={`${node.nodeId}-summary-${index}`} className="rounded-lg border border-dashed border-[var(--border)] p-3">
                  <p className="whitespace-pre-wrap text-[var(--text)]">{statement.text || 'Tekst sažetka nije dostupan.'}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Uzemljenje: nije dokazano; izvorni dokumenti i citati su navedeni samo radi provjere.</p>
                  <div className="mt-1"><span className="text-xs text-[var(--text-muted)]">Izvori: </span>{idList(statement.sourceDocumentIds)}</div>
                  {statement.sourceDocumentIds?.map((sourceId) => (
                    <div key={`${node.nodeId}-${sourceId}`} className="mt-1">
                      <SourceDocumentLink document={sourceDocumentFor(sourceDocumentsById, sourceId)} compact />
                    </div>
                  ))}
                  <div className="mt-1"><span className="text-xs text-[var(--text-muted)]">Činjenice: </span>{idList(statement.factIds)}</div>
                  <div className="mt-1"><span className="text-xs text-[var(--text-muted)]">Citati: </span>{idList(statement.citationIds)}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {Array.isArray(fragment?.facts) && fragment.facts.length > 0 && (
          <div>
            <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Izvadci i uzemljenje</h4>
            <ul className="mt-2 space-y-2">
              {fragment.facts.map((fact) => (
                <li key={fact.factId} className="rounded-lg bg-[var(--surface-muted)] p-3">
                  <p className="font-mono text-xs text-[var(--text-muted)]">{fact.factId} · {fact.fileName || fact.sourceId || 'izvor nije dostupan'}{fact.date ? ` · ${fact.date}` : ''}</p>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--text)]">{fact.excerpt || 'Izvadak nije dostupan.'}</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">Uzemljenje: {fact.grounded === true ? 'potvrđeno' : 'nepotvrđeno'}</p>
                  <SourceDocumentLink
                    document={sourceDocumentFor(sourceDocumentsById, fact.sourceId, fact.fileName)}
                    compact
                  />
                  {fact.citationIds?.length > 0 && <div className="mt-1">Citati: {idList(fact.citationIds)}</div>}
                </li>
              ))}
            </ul>
            {fragment.omittedFactCount > 0 && <p className="mt-1 text-xs text-[var(--text-muted)]">Još {fragment.omittedFactCount} činjenica nije prikazano.</p>}
          </div>
        )}
        {outcome ? (
          <div className="rounded-lg border border-[var(--border)] p-3">
            <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Ishod sažetka</h4>
            <p className="mt-1 text-[var(--text)]">
              Status: <strong>{outcome.status}</strong>
              {outcome.reason ? ` · razlog: ${outcome.reason}` : ''}
            </p>
            <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
              prihvaćeno {outcome.accepted ?? '?'} · odbačeno {outcome.rejected ?? '?'} · poziva {outcome.calls ?? '?'}
            </p>
          </div>
        ) : (
          unavailable('Ishod sažetka za ovaj čvor')
        )}
        {selectionReasons.length > 0 && (
          <div>
            <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Razlog odabira</h4>
            <ul className="mt-1 space-y-1">
              {selectionReasons.map((entry, index) => (
                <li key={`sel-${index}`} className="text-[var(--text)]">
                  {entry.reason || entry.basis || 'odabran determinističkim pravilima'}
                  {entry.detail ? ` — ${entry.detail}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function FlatClaimDetail({ claim, sourceDocumentsById }) {
  if (!claim) return <p className="text-sm text-[var(--text-muted)]">Odaberite tvrdnju s popisa.</p>;
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Tvrdnja · {claim.claimId || 'bez id'}</p>
      <h3 className="mt-1 text-lg font-semibold text-[var(--text)]">{claim.claimId || 'Ravni ulaz'}</h3>
      <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--text)]">{claim.text || 'Tekst tvrdnje nije dostupan.'}</p>
      {claim.evidence?.length ? (
        <div className="mt-4">
          <h4 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Izvorni izvadci i uzemljenje</h4>
          <ul className="mt-2 space-y-2">
            {claim.evidence.map((entry, index) => (
              <li key={`${claim.claimId}-${entry.sourceId || index}`} className="rounded-lg bg-[var(--surface-muted)] p-3">
                <p className="font-mono text-xs text-[var(--text-muted)]">{entry.fileName || entry.sourceId || 'izvor nije dostupan'}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text)]">{entry.text || 'Izvadak nije dostupan.'}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Uzemljenje: {entry.grounded === true ? 'potvrđeno' : entry.grounded === false ? 'nepotvrđeno' : 'nije zabilježeno'}</p>
                <SourceDocumentLink
                  document={sourceDocumentFor(sourceDocumentsById, entry.sourceId, entry.fileName)}
                  compact
                />
                {entry.citationIds?.length > 0 && <div className="mt-1">Citati: {idList(entry.citationIds)}</div>}
              </li>
            ))}
          </ul>
        </div>
      ) : unavailable('Izvorni izvadci za tvrdnju')}
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
          <aside aria-label="Kontekstni čvorovi" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <h3 className="border-b border-[var(--border)] px-3 py-2.5 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
              {isFlat ? 'Ravni ulaz' : `Kontekstni čvorovi · ${profileLabel(activeProfile)}`}
            </h3>
            <div className="max-h-96 overflow-y-auto p-2">
              {isFlat ? (
                <div className="space-y-2 p-1 text-sm">
                  <p className="text-[var(--text)]">
                    Ravni profil nema DAG čvorova: {trace?.claims?.flat ?? '?'} tvrdnji ide izravno u sintezu.
                  </p>
                  {flatClaims.length === 0 ? unavailable('Popis odabranih tvrdnji') : (
                    <ul className="space-y-1">
                      {flatClaims.map((claim, index) => (
                        <li key={claim.claimId || `claim-${index}`}>
                          <button type="button" onClick={() => setSelectedFlatClaimId(claim.claimId)}
                            aria-current={(claim.claimId || null) === (selectedFlatClaim?.claimId || null) ? 'true' : undefined}
                            className="w-full rounded-lg border-l-2 border-l-transparent px-3 py-2 text-left text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2">
                            <span className="block font-mono text-[11px] text-[var(--text-muted)]">{claim.claimId || 'tvrdnja'}</span>
                            <span className="block truncate">{claim.text || 'Tekst nije dostupan.'}</span>
                          </button>
                        </li>
                      ))}
                      {fragments?.flatClaims?.omittedCount > 0 && <li className="p-2 text-xs text-[var(--text-muted)]">Još {fragments.flatClaims.omittedCount} tvrdnji nije prikazano.</li>}
                    </ul>
                  )}
                </div>
              ) : nodes.length === 0 ? (
                <p className="p-2 text-sm text-[var(--text-muted)]">Nema odabranih čvorova.</p>
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
                          <span className="block font-mono text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                            {node?.kind || '?'} · {(node?.factIds || []).length} činjenica
                          </span>
                          <span className="block truncate text-sm font-medium text-[var(--text)]">{node?.nodeId}</span>
                          {outcome && (
                            <span className="mt-0.5 inline-block font-mono text-[11px] text-[var(--text-muted)]">
                              sažetak: {outcome.status}
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
              <NodeDetail node={selectedNode} fragment={selectedNode ? contextFragmentByNode.get(selectedNode.nodeId) : null} outcome={selectedNode ? outcomeByNode.get(selectedNode.nodeId) : null} dagSelections={trace?.dag?.selections} sourceDocumentsById={sourceDocumentsById} />
            )}
          </article>

          <aside aria-label="Trag, potrošnja i snimka profila" className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Izostavljeno i odbačeno</h3>
              {omitted.length === 0 && summaryOmitted.length === 0 && droppedDerived.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--text-muted)]">Ništa nije izostavljeno.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {[...omitted, ...summaryOmitted].map((entry, index) => (
                    <li key={`omit-${index}`} className="text-[var(--text)]">
                      <span className="font-mono text-xs">{entry.nodeId || entry.factId || '?'}</span>
                      {' — '}
                      {entry.reason || '?'}
                      {entry.detail ? ` (${entry.detail})` : ''}
                    </li>
                  ))}
                  {droppedDerived.map((entry, index) => (
                    <li key={`drop-${index}`} className="text-[var(--text)]">
                      <span className="font-mono text-xs">{entry.nodeId || '?'}</span>
                      {' — odbačena izvedena tvrdnja: '}
                      {entry.reason || '?'}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Potrošnja</h3>
              {usage ? (
                <p className="mt-2 font-mono text-xs text-[var(--text)]">
                  {usage.calls ?? '?'} poziva · {usage.totalTokens ?? '?'} tokena · {usage.elapsedMs ?? '?'} ms
                </p>
              ) : (
                unavailable('Potrošnja')
              )}
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
              <h3 className="font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Snimka profila</h3>
              {snapshot ? (
                <dl className="mt-2 space-y-1 font-mono text-xs text-[var(--text)]">
                  <div className="flex justify-between gap-2"><dt className="text-[var(--text-muted)]">strategija</dt><dd>{snapshot.contextStrategy || '?'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-[var(--text-muted)]">sažeci</dt><dd>{snapshot.nodeSummaries || '?'}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-[var(--text-muted)]">revizija</dt><dd className="truncate">{snapshot.codeRevision || '?'}</dd></div>
                </dl>
              ) : (
                unavailable('Snimka profila')
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
