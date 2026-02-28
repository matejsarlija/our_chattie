import React from 'react';

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
    }))
    .filter((citation) => citation.line.length > 0);
};

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
          </li>
        ))}
      </ul>
    </div>
  );
}
