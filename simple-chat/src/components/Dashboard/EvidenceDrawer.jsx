import { useMemo } from 'react';
import Sheet from '../ui/Sheet';
import Callout from '../ui/Callout';

function safeHttpUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function formatPages(pageNumbers) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) return null;
  const sorted = [...new Set(pageNumbers.filter((n) => Number.isFinite(Number(n))).map(Number))].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return `str. ${sorted[0]}`;
  return `str. ${sorted[0]}–${sorted[sorted.length - 1]}`;
}

function findQuoteRange(text, context) {
  if (typeof text !== 'string' || !text) return null;
  const start = context?.sourceStartIndex;
  const end = context?.sourceEndIndex;
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length) {
    return { start, end };
  }

  const quote = typeof context?.quote === 'string' ? context.quote.trim() : '';
  if (!quote) return null;

  const lowerIdx = text.toLowerCase().indexOf(quote.toLowerCase());
  if (lowerIdx >= 0) {
    return { start: lowerIdx, end: lowerIdx + quote.length };
  }

  const escaped = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  try {
    const regex = new RegExp(escaped, 'i');
    const match = regex.exec(text);
    if (match && match[0]) {
      return { start: match.index, end: match.index + match[0].length };
    }
  } catch {
    // Ignore malformed regex edge cases and render unhighlighted text.
  }

  return null;
}

export default function EvidenceDrawer({
  isOpen,
  onClose,
  activeContext,
  chunk,
  loading = false,
  error = '',
}) {
  const title = chunk?.fileName || activeContext?.fileName || 'Izvorni dokument';
  const caseNumber = chunk?.caseNumber || activeContext?.caseNumber || null;
  const entryDisplayId = chunk?.entryDisplayId || activeContext?.entryDisplayId || null;
  const pagesLabel = formatPages(chunk?.pageNumbers || activeContext?.pageNumbers);
  const externalUrl = safeHttpUrl(activeContext?.url || chunk?.url);

  const description = [caseNumber, entryDisplayId ? `objava ${entryDisplayId}` : null, pagesLabel]
    .filter(Boolean)
    .join(' · ');

  const range = useMemo(
    () => findQuoteRange(chunk?.text, activeContext),
    [chunk?.text, activeContext],
  );

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
      title={title}
      description={description || 'Pregled izvornog isječka dokumenta'}
      size="lg"
    >
      <div className="space-y-4">
        {pagesLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="pill">{pagesLabel}</span>
            {caseNumber ? <span className="pill font-mono">{caseNumber}</span> : null}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-2.5" aria-busy="true" aria-label="Učitavanje izvornog isječka">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        ) : error ? (
          <div className="space-y-3">
            <Callout tone="danger" glyph="!" alert title="Isječak nije dostupan">
              {error}
            </Callout>
            {activeContext?.quote ? (
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <p className="eyebrow">Spremljeni navod</p>
                <blockquote className="mt-1.5 text-sm italic leading-relaxed text-ink">
                  „{activeContext.quote}”
                </blockquote>
              </div>
            ) : null}
          </div>
        ) : chunk?.text ? (
          <div className="space-y-3">
            {!range && activeContext?.quote ? (
              <div className="rounded-md border border-line bg-warning-surface/60 px-3.5 py-2.5">
                <p className="eyebrow">Izdvojeni navod</p>
                <blockquote className="mt-1 text-sm leading-relaxed text-ink">
                  „{activeContext.quote}”
                </blockquote>
              </div>
            ) : null}
            <div className="rounded-lg border border-line bg-surface-muted/45 p-4">
              <p className="eyebrow mb-2">Izvorni tekst isječka</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink">
                {range ? (
                  <>
                    {chunk.text.slice(0, range.start)}
                    <mark className="rounded-sm border-b-2 border-warning bg-warning-surface px-1 py-0.5 font-semibold text-ink">
                      {chunk.text.slice(range.start, range.end)}
                    </mark>
                    {chunk.text.slice(range.end)}
                  </>
                ) : (
                  chunk.text
                )}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Tekst isječka nije dostupan.</p>
        )}

        {externalUrl ? (
          <div className="border-t border-line pt-3">
            <a
              href={externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              Otvori izvornik (e-Oglasna)
            </a>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
