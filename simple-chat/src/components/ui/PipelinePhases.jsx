/**
 * Pipeline status as four phases, not eleven equal dots.
 *
 * WHY. `useAnalysisEvents` returns all 11 canonical stages and the old
 * `RunProgressStepper` rendered every one of them in a 1/2/4-column grid with a
 * 10px dot. The audit measured those dots at 1.48:1 (pending) and 2.54:1
 * (done) — both below the 3:1 non-text threshold — so the only thing carrying
 * "this stage finished" was a nearly invisible dot.
 *
 * Collapsing to four phases answers the question the page is actually asked
 * ("where is my case") in one glance, and puts the one stage that carries loss
 * (Dokumenti, 57/63) where it is visible rather than buried among ten ✓.
 *
 * The eleven raw stages stay available inside a disclosure for auditing, and the
 * phase glyph is a glyph — never colour alone, since the §3.4 status palette
 * has a 1.07:1 luminance ratio between success and warning.
 *
 * Counts come from real sources, not from the phase itself:
 *   Prikupljanje → scope.corpus.capturedEntries   (objects discovered)
 *   Dokumenti   → coverage.analyzed / total / failed
 *   Dokazi      → report.meta.retrieval.metrics.matchCount
 */

const PHASES = [
  { key: 'discovery', label: 'Prikupljanje', stages: ['queued', 'starting', 'discovering'] },
  { key: 'documents', label: 'Dokumenti', stages: ['grouping', 'downloading', 'extracting'] },
  { key: 'evidence', label: 'Dokazi', stages: ['chunking', 'retrieving'] },
  { key: 'conclusion', label: 'Zaključak', stages: ['reasoning', 'verifying', 'complete'] },
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {object}   props
 * @param {Array}    props.stages      from useAnalysisEvents: [{key,label,completed,active}]
 * @param {boolean}  props.isErrored
 * @param {object?}  props.coverage    analysis coverage object
 * @param {object?}  props.scope       scope contract (corpus.capturedEntries)
 * @param {object?}  props.retrieval   report.meta.retrieval
 */
export default function PipelinePhases({ stages, isErrored = false, runStatus, coverage, scope, retrieval }) {
  const list = Array.isArray(stages) ? stages : [];
  const byKey = new Map(list.map((stage) => [stage?.key, stage]));

  const captured = isNum(scope?.corpus?.capturedEntries) ? scope.corpus.capturedEntries : null;
  const analyzed = isNum(coverage?.analyzed) ? coverage.analyzed : null;
  const total = isNum(coverage?.total) ? coverage.total : null;
  const failed = isNum(coverage?.failed) ? coverage.failed : null;
  const matches = isNum(retrieval?.metrics?.matchCount) ? retrieval.metrics.matchCount : null;

  /** A phase is done when every one of its stages is completed. */
  const phaseState = (phase) => {
    const members = phase.stages.map((key) => byKey.get(key)).filter(Boolean);
    if (!members.length) return 'pending';
    if (members.some((member) => member.active)) return 'active';
    if (members.every((member) => member.completed)) return 'done';
    return 'pending';
  };

  /** The one figure worth showing for this phase, or null. */
  const phaseDetail = (key) => {
    if (key === 'discovery' && captured !== null) return `${captured.toLocaleString('hr-HR')} objava pronađeno`;
    if (key === 'documents') {
      if (analyzed === null && total === null) return null;
      const base = `${analyzed ?? '—'} / ${total ?? '—'}`;
      return failed ? `${base} · ${failed} neuspjelo` : base;
    }
    if (key === 'evidence' && matches !== null) {
      return `${matches.toLocaleString('hr-HR')} podudaranja`;
    }
    return null;
  };

  const stageNames = (phase) =>
    phase.stages.map((key) => byKey.get(key)?.label).filter(Boolean).join(' · ');

  const terminalStatus = String(runStatus || '').toLowerCase();
  const isTerminalFailure = isErrored || ['error', 'failed', 'cancelled', 'canceled', 'aborted'].includes(terminalStatus);
  const isTerminalSuccess = ['done', 'completed', 'complete', 'success'].includes(terminalStatus);
  const heading = isTerminalFailure
    ? 'Prekinuto'
    : isTerminalSuccess || !list.some((stage) => stage?.active)
      ? 'Završeno'
      : 'U tijeku';

  return (
    <section className="card p-3.5" aria-labelledby="pipeline-heading">
      <div className="flex items-center justify-between gap-2">
        <h3 id="pipeline-heading" className="sec-title">
          {heading}
        </h3>
      </div>

      <ol className="mt-3 space-y-1">
        {PHASES.map((phase) => {
          const state = phaseState(phase);
          const detail = phaseDetail(phase.key);
          const names = stageNames(phase);
          // "Dokumenti" is the phase that can carry real loss; mark it.
          const lossy = phase.key === 'documents' && failed !== null && failed > 0;
          const glyph = state === 'done' ? '✓' : state === 'active' ? '◐' : '·';

          return (
            <li key={phase.key} className="flex gap-2.5 py-1">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[11px] ${
                  lossy && state !== 'active'
                    ? 'bg-warning-surface text-warning'
                    : state === 'active'
                      ? 'bg-info-surface text-info'
                      : state === 'done'
                        ? 'bg-success-surface text-success'
                        : 'bg-surface-muted text-ink-muted'
                }`}
              >
                {glyph}
              </span>
              <div className="min-w-0">
                <div className={`text-sm ${state === 'pending' ? 'text-ink-muted' : 'text-ink'}`}>
                  {phase.label}
                </div>
                {names ? <div className="text-xs text-ink-muted">{names}</div> : null}
                {detail ? <div className="text-xs tabular-nums text-ink-muted">{detail}</div> : null}
              </div>
            </li>
          );
        })}
      </ol>

      {list.length > 0 ? (
        <details className="mt-2 border-t border-line pt-2">
          <summary className="cursor-pointer list-none text-xs text-ink-muted hover:text-ink">
            Svih {list.length} faza
          </summary>
          <ol className="mt-2 space-y-0.5 font-mono text-[11px] text-ink-muted">
            {list.map((stage, index) => (
              <li key={stage?.key || index}>
                {String(index + 1).padStart(2, '0')} {stage?.key} · {stage?.label}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}

export { PHASES };