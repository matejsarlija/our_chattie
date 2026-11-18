import React from 'react';

export default function AnalysisDocumentParties({ analyses = [], sourceDocuments = [] }) {
  const sourceById = new Map(
    (Array.isArray(sourceDocuments) ? sourceDocuments : []).map((source) => [source.id, source]),
  );
  const identities = (Array.isArray(analyses) ? analyses : []).flatMap((analysis, analysisIndex) => {
    const source = sourceById.get(analysis?.id);
    return (Array.isArray(analysis?.documentParties) ? analysis.documentParties : []).map((party, partyIndex) => ({
      ...party,
      key: `${analysis?.id || analysisIndex}:${party?.oib || 'unknown'}:${partyIndex}`,
      fileName: source?.fileName || analysis?.fileName || 'Izvorni dokument',
      url: source?.url || null,
    }));
  });

  if (identities.length === 0) return null;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="document-parties-heading" data-testid="document-parties">
      <div>
        <p className="eyebrow">Izvorni identiteti</p>
        <h2 id="document-parties-heading" className="mt-1 text-lg font-semibold tracking-tight text-ink">
          OIB-ovi navedeni u dokumentima
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm leading-relaxed text-ink-muted">
          Prikazuju se samo identiteti izvučeni iz teksta dokumenta. Navod uz svaki OIB omogućuje provjeru veze s imenom i ulogom.
        </p>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {identities.map((party) => (
          <li key={party.key} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(12rem,0.8fr)_minmax(0,1.5fr)] sm:gap-5">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-ink">{party.name || 'Ime nije navedeno uz OIB'}</p>
              {party.role ? <p className="mt-0.5 text-xs text-ink-muted">Uloga u dokumentu: {party.role}</p> : null}
              <code className="mt-1 inline-block break-all font-mono text-sm tabular-nums text-ink">{party.oib}</code>
              <p className="mt-1 text-xs text-ink-muted">
                {party.url ? <a className="underline decoration-line underline-offset-2 hover:text-accent" href={party.url} target="_blank" rel="noreferrer">{party.fileName}</a> : party.fileName}
              </p>
            </div>
            <div className="min-w-0">
              <blockquote className="border-l-2 border-line pl-3 text-sm leading-relaxed text-ink-muted">{party.quote || 'Izvorni navod nije dostupan.'}</blockquote>
              <p className={`mt-1 text-xs ${party.grounded === true ? 'text-success' : party.grounded === false ? 'text-warning' : 'text-ink-muted'}`}>
                {party.grounded === true ? 'Navod potvrđen u tekstu' : party.grounded === false ? 'Navod nije potvrđen — provjerite izvornik' : 'Provjera navoda nije dostupna'}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
