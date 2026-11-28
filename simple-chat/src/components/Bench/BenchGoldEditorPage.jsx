import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
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

  useEffect(() => {
    if (template) {
      setFactsJson(JSON.stringify(template.facts || {}, null, 2));
      setReviewed(template.reviewedCategories || []);
      setComplete(Boolean(template.factsComplete));
    }
  }, [template]);

  const currentSet = sets.find((s) => s.setId === selectedSet);
  const totalPages = Number(template?.document?.pages || 1);

  const toggleCategory = (cat) => {
    setReviewed((prev) => (prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]));
  };

  const handleSave = async () => {
    setSaveMsg(null);
    const parsed = JSON.parse(factsJson || '{}');
    await saveTemplate({ facts: parsed, factsComplete: complete, reviewedCategories: reviewed });
    setSaveMsg('Gold predložak je spremljen.');
  };

  const handleSuggest = async () => {
    const res = await requestSuggestion();
    if (res?.facts) {
      setFactsJson(JSON.stringify(res.facts, null, 2));
    }
  };

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link to="/dashboard/bench" className="text-xs text-[var(--accent)] hover:underline">
              ← Natrag na Bench
            </Link>
            <h1 className="text-xl font-semibold text-[var(--text)] mt-1">Gold Editor</h1>
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
              className="rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
            >
              {sets.map((s) => (
                <option key={s.setId} value={s.setId}>{s.setId}</option>
              ))}
            </select>
            <select
              aria-label="Gold dokument"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
              className="rounded-lg border border-[var(--border-control)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
            >
              {(currentSet?.documents || []).map((d) => (
                <option key={d.file} value={d.file}>{d.docId || d.file}</option>
              ))}
            </select>
          </div>
        </div>

        {error ? <Callout tone="danger" alert title="Greška">{error}</Callout> : null}
        {saveMsg ? <Callout tone="success" title="Spremljeno">{saveMsg}</Callout> : null}
        {loading ? <p className="text-sm text-[var(--text-muted)]">Učitavam Gold predložak...</p> : null}

        {template ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text)]">
                  Stranica {page} / {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded border border-[var(--border-control)] px-2.5 py-1 text-xs disabled:opacity-50"
                  >
                    Prethodna
                  </button>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="rounded border border-[var(--border-control)] px-2.5 py-1 text-xs disabled:opacity-50"
                  >
                    Sljedeća
                  </button>
                </div>
              </div>
              <img
                src={getBenchGoldPageUrl(selectedSet, selectedFile, page)}
                alt={`Stranica ${page} dokumenta ${template.document?.docId || selectedFile}`}
                className="w-full rounded border border-[var(--border)]"
              />
            </section>

            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--text)]">
                  Činjenice ({summary?.facts ?? 0})
                </h2>
                <button
                  type="button"
                  onClick={handleSuggest}
                  className="rounded border border-[var(--border-control)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[var(--surface-muted)]"
                >
                  AI prijedlog (approved)
                </button>
              </div>

              <textarea
                aria-label="Gold facts JSON"
                rows={16}
                value={factsJson}
                onChange={(e) => setFactsJson(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-control)] bg-[var(--surface)] p-2.5 font-mono text-xs text-[var(--text)]"
              />

              <div className="space-y-2">
                <div className="text-xs font-medium text-[var(--text-muted)]">Pregledane kategorije:</div>
                <div className="flex flex-wrap gap-3">
                  {CATEGORIES.map((cat) => (
                    <label key={cat} className="inline-flex items-center gap-1.5 text-xs text-[var(--text)]">
                      <input
                        type="checkbox"
                        checked={reviewed.includes(cat)}
                        onChange={() => toggleCategory(cat)}
                      />
                      {cat}
                    </label>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-[var(--text)]">
                  <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
                  Označi kao potpuno pregledano (factsComplete)
                </label>
              </div>

              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Spremam...' : 'Spremi Gold'}
              </button>
            </section>
          </div>
        ) : null}
      </main>
    </DashboardShell>
  );
}
