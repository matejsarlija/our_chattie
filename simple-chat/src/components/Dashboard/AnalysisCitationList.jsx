import React, { useState } from 'react';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const formatCitationLine = (citation) => {
  const chunks = [];
  if (citation.source) chunks.push(String(citation.source));
  if (citation.fileName) chunks.push(String(citation.fileName));

  if (citation.page || citation.pageNumber) {
    const page = citation.page || citation.pageNumber;
    chunks.push(`str. ${page}`);
  } else if (citation.location) {
    chunks.push(String(citation.location));
  }

  return chunks.join(' | ');
};

const normalizeCitations = (citations) => {
  if (!Array.isArray(citations)) return [];
  return citations
    .filter(isObject)
    .map((citation, index) => {
      const page = citation.page || citation.pageNumber;
      const pageNumbers = Array.isArray(citation.pageNumbers)
        ? citation.pageNumbers
        : Array.isArray(citation.sourcePages)
          ? citation.sourcePages
          : page
            ? [page]
            : [];
      return {
        key: `${citation.source || ''}-${citation.fileName || ''}-${index}`,
        line: formatCitationLine(citation),
        url: citation.url || citation.link || null,
        chunkId: citation.chunkId || citation.sourceChunkId || null,
        docId: citation.docId || null,
        quote: citation.quote || null,
        fileName: citation.fileName || null,
        pageNumbers,
        retrievedBy: Array.isArray(citation.retrievedBy) ? citation.retrievedBy : [],
      };
    })
    .filter((citation) => citation.line.length > 0);
};

function RetrievalLinks({ links }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(links) || links.length === 0) return null;

  return (
    <details
      className="mt-1.5"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink">
        Zašto je dohvaćeno ({links.length})
      </summary>
      <ul className="mt-1.5 space-y-1 border-l-2 border-line pl-2.5">
        {links.map((link, i) => (
          <li key={link.queryId || i} className="text-xs text-ink-muted">
            <span className="font-mono text-ink">{link.queryText || link.queryId || 'nepoznat upit'}</span>
            {typeof link.score === 'number' ? (
              <span className="tabular-nums"> · ocjena {link.score.toFixed(2)}</span>
            ) : null}
            {link.queryPurpose ? <span> · {link.queryPurpose}</span> : null}
            {Array.isArray(link.reasons) && link.reasons.length > 0 ? (
              <span className="mt-0.5 block font-mono text-[11px]">{link.reasons.join(' · ')}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AnalysisCitationList({ citations, onOpenEvidence }) {
  const normalized = normalizeCitations(citations);
  if (normalized.length === 0) return null;

  return (
    <ul className="space-y-2" data-testid="citation-list">
      {normalized.map((citation, index) => {
        const canOpenDrawer = Boolean(onOpenEvidence && citation.chunkId);
        const Body = (
          <>
            <span className="text-ink">{citation.line}</span>
            {citation.url ? (
              <span className="ml-2 text-xs text-accent">Otvori izvor</span>
            ) : null}
          </>
        );

        return (
          <li key={citation.key}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xs text-ink-muted">{index + 1}</span>
              {canOpenDrawer ? (
                <>
                  <button
                    type="button"
                    onClick={() => onOpenEvidence({
                      chunkId: citation.chunkId,
                      docId: citation.docId,
                      quote: citation.quote,
                      fileName: citation.fileName,
                      pageNumbers: citation.pageNumbers,
                      url: citation.url,
                    })}
                    className="text-left text-sm text-ink hover:text-accent hover:underline"
                  >
                    <span>{citation.line}</span>
                    <span className="ml-2 text-xs font-medium text-accent">Prikaži u kontekstu</span>
                  </button>
                  {citation.url ? (
                    <a
                      href={citation.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-ink-muted hover:text-accent hover:underline"
                    >
                      Otvori izvor
                    </a>
                  ) : null}
                </>
              ) : citation.url ? (
                <a
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  {Body}
                </a>
              ) : (
                <span className="text-sm">{Body}</span>
              )}
            </div>
            <RetrievalLinks links={citation.retrievedBy} />
          </li>
        );
      })}
    </ul>
  );
}
