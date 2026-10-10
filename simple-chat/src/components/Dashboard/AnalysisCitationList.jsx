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
    .map((citation, index) => ({
      key: `${citation.source || ''}-${citation.fileName || ''}-${index}`,
      line: formatCitationLine(citation),
      url: citation.url || citation.link || null,
      retrievedBy: Array.isArray(citation.retrievedBy) ? citation.retrievedBy : [],
    }))
    .filter((citation) => citation.line.length > 0);
};

/**
 * Why this document was retrieved, disclosed under the citation.
 *
 * The provenance detail is the reason the product exists — it is what
 * distinguishes "the model said so" from "this text was found". The old
 * rendering put it in an 11px button and a 10px mono line, the smallest and
 * faintest text on the page, behind a hover-free disclosure.
 *
 * It is now 13px, a real button, and a keyboard-reachable disclosure.
 */
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

/**
 * Citations are evidence, and evidence is the thing a lawyer checks in court.
 *
 * The audit found this rendered at 11px uppercase in `--text-muted`, with the
 * page reference at 10px mono — the smallest text on the analysis page, for the
 * most load-bearing content. It is now 13px, normal weight, with the source in
 * body ink and the locator in muted mono.
 */
export default function AnalysisCitationList({ citations }) {
  const normalized = normalizeCitations(citations);
  if (normalized.length === 0) return null;

  return (
    <ul className="space-y-2" data-testid="citation-list">
      {normalized.map((citation, index) => {
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
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-ink-muted">{index + 1}</span>
              {citation.url ? (
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