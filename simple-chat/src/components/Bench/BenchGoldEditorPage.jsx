import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import { useBenchGoldEditor } from '../../hooks/useBenchGoldEditor';
import { getBenchGoldPageUrl } from '../../lib/apiClient';

const CATEGORIES = ['amounts', 'propertyFlow', 'documentParties', 'proceduralEvents'];

export default function BenchGoldEditorPage() {
  const {
    sets,
    selectedSet,
    setSelectedSet,
    selectedFile,
    setSelectedFile,
    template,
    summary,
    page,
    setPage,
    loading,
    saving,
    error,
    saveTemplate,
    requestSuggestion,
  } = useBenchGoldEditor();

  const [factsJson, setFactsJson] = useState('{}');
  const [reviewed, setReviewed] = useState([]);
  const [complete, setComplete] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [jsonError, setJsonError] = useState('');
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (template) {
      setFactsJson(JSON.stringify(template.facts || {}, null, 2));
      setReviewed(template.reviewedCategories || []);
      setComplete(Boolean(template.factsComplete));
      setJsonError('');
    }
  }, [template]);

  const currentSet = sets.find((s) => s.setId === selectedSet);
  const totalPages = Number(template?.document?.pages || 1);

  const categoryCounts = useMemo(() => {
    try {
      const parsed = JSON.parse(factsJson || '{}');
      return CATEGORIES.reduce((acc, cat) => {
        acc[cat] = Array.isArray(parsed?.[cat]) ? parsed[cat].length : 0;
        return acc;
      }, {});
    } catch {
      return null;
    }
  }, [factsJson]);

  const toggleCategory = (cat) => {
    setReviewed((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  const handleSave = useCallback(async () => {
    setSaveMsg(null);
    setJsonError('');
    let parsed;
    try {
      parsed = JSON.parse(factsJson || '{}');
    } catch (err) {
      setJsonError(`Neispravan JSON: ${err.message}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setJsonError('JSON mora biti objekt s kategorijama činjenica.');
      return;
    }
    await saveTemplate({ facts: parsed, factsComplete: complete, reviewedCategories: reviewed });
    setSaveMsg('Gold predložak je spremljen.');
  }, [factsJson, complete, reviewed, saveTemplate]);

  const handleSuggest = async () => {
    setJsonError('');
    const res = await requestSuggestion();
    if (res?.facts) {
      setFactsJson(JSON.stringify(res.facts, null, 2));
    }
  };

  useEffect(() => {
    if (!template) return undefined;
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void handleSave();
        return;
      }
      const tag = String(event.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) {
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPage((p) => Math.max(1, p - 1));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPage((p) => Math.min(totalPages, p + 1));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [template, totalPages, setPage, handleSave]);

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard/bench" className="text-xs text-accent hover:underline">
              ← Natrag na Bench
            </Link>
            <h1 className="mt-1 text-xl font-semibold text-ink">Gold Editor</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Gold skup"
              value={selectedSet}
              onChange={(e) => {
                const nextSet = e.target.value;
                setSelectedSet(nextSet);
                const first = sets.find((s) => s.setId === nextSet)?.documents?.[0]?.file || '';
                setSelectedFile(first);
              }}
              className="rounded-md border border-line-control bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent"
            >
              {sets.map((s) => (
                <option key={s.setId} value={s.setId}>{s.setId}</option>
              ))}
            </select>
            <select
              aria-label="Gold dokument"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="rounded-md border border-line-control bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent"
            >
              {(currentSet?.documents || []).map((d) => (
                <option key={d.file} value={d.file}>{d.docId || d.file}</option>
              ))}
            </select>
          </div>
        </div>

        {error ? <Callout tone="danger" alert title="Greška">{error}</Callout> : null}
        {saveMsg ? <Callout tone="success" title="Spremljeno">{saveMsg}</Callout> : null}
        {loading ? <p className="text-sm text-ink-muted">Učitavam Gold predložak...</p> : null}

        {template ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium tabular-nums text-ink">
                  Stranica {page} / {totalPages}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setZoomed((prev) => !prev)}
                    aria-pressed={zoomed}
                  >
                    {zoomed ? 'Zoom 150%' : 'Zoom 100%'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prethodna
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Sljedeća
                  </Button>
                </div>
              </div>
              <div className="max-h-[75vh] overflow-auto rounded-md border border-line bg-surface-muted/30">
                <img
                  src={getBenchGoldPageUrl(selectedSet, selectedFile, page)}
                  alt={`Stranica ${page} dokumenta ${template.document?.docId || selectedFile}`}
                  className={zoomed ? 'w-[150%] max-w-none' : 'w-full'}
                />
              </div>
            </section>

            <section className="card space-y-4 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold tabular-nums text-ink">
                  Činjenice ({summary?.facts ?? 0})
                </h2>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleSuggest}
                >
                  AI prijedlog (approved)
                </Button>
              </div>

              {categoryCounts ? (
                <div className="flex flex-wrap gap-1.5" data-testid="gold-category-counts">
                  {CATEGORIES.map((cat) => (
                    <Badge key={cat} tone="neutral" className="px-2 py-0.5 font-mono text-xs tabular-nums">
                      {cat}: {categoryCounts[cat]}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <textarea
                aria-label="Gold facts JSON"
                rows={16}
                value={factsJson}
                onChange={(e) => {
                  setFactsJson(e.target.value);
                  if (jsonError) setJsonError('');
                }}
                aria-invalid={Boolean(jsonError)}
                className="w-full rounded-md border border-line-control bg-surface p-2.5 font-mono text-xs text-ink focus:border-accent"
              />

              {jsonError ? (
                <p role="alert" className="text-xs text-danger">
                  {jsonError}
                </p>
              ) : null}

              <div className="space-y-2">
                <div className="text-xs font-medium text-ink-muted">Pregledane kategorije:</div>
                <div className="flex flex-wrap gap-3">
                  {CATEGORIES.map((cat) => (
                    <label key={cat} className="inline-flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={reviewed.includes(cat)}
                        onChange={() => toggleCategory(cat)}
                      />
                      {cat}
                    </label>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-ink">
                  <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
                  Označi kao potpuno pregledano (factsComplete)
                </label>
              </div>

              <Button
                type="button"
                variant="primary"
                disabled={saving}
                onClick={handleSave}
              >
                {saving ? 'Spremam...' : 'Spremi Gold'}
              </Button>
            </section>
          </div>
        ) : null}
      </main>
    </DashboardShell>
  );
}
