import { formatScoreCell, profileLabel, LAB_PROFILE_ORDER } from './labMeta';

const ROWS = [
  { key: 'grounded', label: 'Utemeljene izvorne tvrdnje', note: 'Isti kanonski paket dokaza', get: (scorecard) => {
    const grounded = scorecard?.sourceSupport?.groundedSourceClaims;
    const total = scorecard?.sourceSupport?.totalSourceClaims;
    if (grounded === 'unknown' || total === 'unknown' || grounded == null || total == null) return 'unknown';
    return `${grounded} / ${total}`;
  } },
  { key: 'cited', label: 'Nalazi s valjanim citatima', note: 'Broj nalaza, ne izvornih tvrdnji', get: (scorecard) => scorecard?.sourceSupport?.reportFindingsWithValidCitations ?? 'unknown' },
  { key: 'failed', label: 'Neuspjeli ključni dokumenti', note: 'Isti paket dokaza', get: (scorecard) => scorecard?.coverage?.criticalFailedDocuments ?? 'unknown' },
  { key: 'unresolved', label: 'Nerazriješene veze', note: 'Ista DAG struktura', get: (scorecard) => scorecard?.shape?.unresolvedNodes ?? 'unknown' },
  { key: 'currency', label: 'Valutni konflikti', note: 'Zajednički izračun', get: (scorecard) => scorecard?.reconciliation?.currencyConflicts ?? 'unknown' },
  { key: 'calls', label: 'Modelski pozivi', note: '', get: (scorecard) => scorecard?.cost?.calls ?? 'unknown' },
  { key: 'partial', label: 'Djelomični čvorovi', note: 'Status čvora i ishod sažetka; broji jedinstvene čvorove', get: (scorecard) => {
    const stats = scorecard?.cost?.nodeSummaryCalls;
    if (stats === 'n/a') return 'n/a';
    const partial = scorecard?.shape?.partialNodes;
    return partial ?? 'unknown';
  } },
];

export default function LabScorecardTable({ variants }) {
  return (
    <section aria-labelledby="lab-scorecard-title" className="mt-6 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-end justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div>
          <h2 id="lab-scorecard-title" className="text-lg font-semibold text-[var(--text)]">Deterministička kartica provjere</h2>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">Opisuje razliku; ne proglašava pobjednika.</p>
        </div>
        <span className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
          Isti ulaz ✓
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Mjera</th>
              {LAB_PROFILE_ORDER.map((profileId) => (
                <th
                  key={profileId}
                  scope="col"
                  aria-label={`Profil ${profileLabel(profileId)}`}
                  className="px-4 py-2.5 text-right font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]"
                >
                  {profileLabel(profileId)}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Napomena</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border)] last:border-0">
                <td className="px-4 py-2.5 text-left text-[var(--text)]">{row.label}</td>
                {LAB_PROFILE_ORDER.map((profileId) => {
                  const cell = formatScoreCell(row.get(variants?.[profileId]?.deterministicScorecard));
                  return (
                    <td
                      key={profileId}
                      aria-label={`${row.label}, ${profileLabel(profileId)}: ${cell.text}`}
                      title={cell.title}
                      className="px-4 py-2.5 text-right font-medium text-[var(--text)]"
                    >
                      {cell.text}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-left text-[var(--text-muted)]">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
