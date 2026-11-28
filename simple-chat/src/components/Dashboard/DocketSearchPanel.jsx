import Input from '../ui/Input';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import { useDocketSearch } from '../../hooks/useDocketSearch';

function formatPages(pageNumbers) {
  if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) return null;
  const nums = [...new Set(pageNumbers.filter((n) => Number.isFinite(Number(n))).map(Number))].sort((a, b) => a - b);
  if (nums.length === 0) return null;
  if (nums.length === 1) return `str. ${nums[0]}`;
  return `str. ${nums[0]}–${nums[nums.length - 1]}`;
}

export default function DocketSearchPanel({ runId, onOpenEvidence }) {
  const {
    query,
    setQuery,
    results,
    total,
    loading,
    error,
    offset,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
  } = useDocketSearch(runId);

  const trimmed = query.trim();

  return (
    <section className="card p-5" aria-labelledby="docket-search-heading" data-testid="docket-search-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="docket-search-heading" className="sec-title">Pretraga spisa</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Pretražite puni tekst svih obrađenih dokumenata u ovom predmetu (FTS5 BM25).
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pretraži OIB, poslovni broj, vjerovnika, iznos…"
            aria-label="Pretraga teksta spisa"
          />
        </div>
        {query ? (
          <Button variant="ghost" size="sm" onClick={() => setQuery('')}>
            Očisti
          </Button>
        ) : null}
      </div>

      {!trimmed ? (
        <div className="mt-4 rounded-md border border-dashed border-line-control bg-surface-muted/40 px-4 py-6 text-center">
          <p className="text-sm text-ink-muted">
            Unesite pojam za pretragu (npr. OIB, poslovni broj, naziv vjerovnika ili novčani iznos).
          </p>
        </div>
      ) : loading ? (
        <div className="mt-4 space-y-2.5" aria-busy="true" aria-label="Pretraživanje spisa">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="rounded-lg border border-line p-4">
              <div className="skeleton h-4 w-1/3" />
              <div className="skeleton mt-2 h-3.5 w-full" />
              <div className="skeleton mt-1.5 h-3.5 w-4/5" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="mt-4">
          <Callout tone="danger" glyph="!" alert title="Pretraga spisa nije uspjela">
            {error}
          </Callout>
        </div>
      ) : results.length === 0 ? (
        <div className="mt-4 rounded-md border border-line bg-surface-muted/40 px-4 py-6 text-center">
          <p className="text-sm text-ink-muted">
            Nema pronađenih isječaka za upit „{trimmed}”.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-xs tabular-nums text-ink-muted">
            Prikaz {offset + 1}–{offset + results.length} od {total} rezultata
          </p>

          <ul className="space-y-2.5" data-testid="docket-search-results">
            {results.map((chunk, index) => {
              const chunkId = chunk.chunkId || chunk.id;
              const pagesLabel = formatPages(chunk.pageNumbers);
              const fileName = chunk.fileName ? String(chunk.fileName).split(/[\\/]/).pop() : 'Izvorni dokument';
              const snippet = chunk.snippet || chunk.preview || chunk.excerpt || '';

              return (
                <li
                  key={chunkId || `chunk-${index}`}
                  className="rounded-lg border border-line bg-surface p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{fileName}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {[chunk.caseNumber, pagesLabel].filter(Boolean).join(' · ') || 'Dokument predmeta'}
                      </p>
                    </div>
                    {onOpenEvidence && chunkId ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onOpenEvidence({
                          chunkId,
                          docId: chunk.docId,
                          quote: trimmed,
                          fileName,
                          pageNumbers: chunk.pageNumbers,
                          caseNumber: chunk.caseNumber,
                          url: chunk.url,
                        })}
                      >
                        Prikaži u kontekstu
                      </Button>
                    ) : null}
                  </div>
                  {snippet ? (
                    <p className="mt-2 text-sm leading-relaxed text-ink-muted">{snippet}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {hasPrev || hasNext ? (
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-xs tabular-nums text-ink-muted">
                {offset + 1}–{offset + results.length} od {total}
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
  );
}
