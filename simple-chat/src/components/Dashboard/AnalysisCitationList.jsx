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
    .map((citation) => ({
      line: formatCitationLine(citation),
      url: citation.url || citation.link || null,
      retrievedBy: Array.isArray(citation.retrievedBy) ? citation.retrievedBy : [],
    }))
    .filter((citation) => citation.line.length > 0);
};

function RetrievalLinks({ links }) {
  const [open, setOpen] = useState(false);
  if (!Array.isArray(links) || links.length === 0) return null;
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="text-[11px] text-[var(--accent)] hover:underline"
      >
        {open ? 'Sakrij zašto je dohvaćeno ▾' : `Zašto je dohvaćeno (${links.length}) ▸`}
      </button>
      {open && (
        <ul className="mt-1 space-y-1 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1.5">
          {links.map((link, i) => (
            <li key={link.queryId || i} className="text-[11px]">
              <span className="font-mono text-[var(--text)]">{link.queryText || link.queryId || 'nepoznat upit'}</span>
              {typeof link.score === 'number' ? (
                <span className="text-[var(--text-muted)]"> (ocjena {link.score.toFixed(2)})</span>
              ) : null}
              {link.queryPurpose ? (
                <span className="text-[var(--text-muted)]"> · {link.queryPurpose}</span>
              ) : null}
              {Array.isArray(link.reasons) && link.reasons.length > 0 ? (
                <span className="block font-mono text-[10px] text-[var(--text-muted)]">{link.reasons.join(' · ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AnalysisCitationList({ citations }) {
  const normalized = normalizeCitations(citations);
  if (normalized.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-2">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Citati</p>
      <ul className="space-y-1">
        {normalized.map((citation, index) => (
          <li key={`${citation.line}-${index}`} className="text-xs text-[var(--text-muted)]">
            <span>{citation.line}</span>
            {citation.url && (
              <>
                {' '}
                <a href={citation.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                  Otvori izvor
                </a>
              </>
            )}
            <RetrievalLinks links={citation.retrievedBy} />
          </li>
        ))}
      </ul>
    </div>
  );
}
