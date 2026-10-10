import { formatScoreCell, profileLabel, LAB_PROFILE_ORDER } from './labMeta';

const ROWS = [
  { key: 'grounded', label: 'Tvrdnje potvrđene u izvornom tekstu', note: 'Izvadak pronađen u izvornom dokumentu / sve izdvojene tvrdnje.', get: (scorecard) => {
    const grounded = scorecard?.sourceSupport?.groundedSourceClaims;
    const total = scorecard?.sourceSupport?.totalSourceClaims;
    if (grounded === 'unknown' || total === 'unknown' || grounded == null || total == null) return 'unknown';
    return `${grounded} / ${total}`;
  } },
  { key: 'cited', label: 'Nalazi s navedenim izvorom', note: 'Broji nalaze povezane s dokumentom; sama veza ne potvrđuje da dokument potkrepljuje nalaz. Otvorite puni izvještaj za popis nalaza i citate.', get: (scorecard) => {
    const cited = scorecard?.sourceSupport?.reportFindingsWithValidCitations;
    const total = scorecard?.sourceSupport?.reportFindingsTotal;
    if (cited === 'unknown' || total === 'unknown' || cited == null || total == null) return 'unknown';
    return `${cited} / ${total}`;
  } },
  { key: 'failed', label: 'Dokumenti koji nisu uspješno analizirani', note: 'Ovi dokumenti nisu prošli analizu; neuspjeh je u zajedničkom ulazu pa se ponavlja za sve varijante.', get: (scorecard) => scorecard?.coverage?.criticalFailedDocuments ?? 'unknown' },
  { key: 'unresolved', label: 'Činjenice ostavljene odvojeno', note: 'Nedostaje broj prijave ili oznaka podneska za sigurno povezivanje; analiza ih ne spaja nagađanjem.', get: (scorecard) => scorecard?.shape?.unresolvedNodes ?? 'unknown' },
  { key: 'currency', label: 'Uočena valutna odstupanja', note: 'Razlike u iznosima navedenima u više valuta.', get: (scorecard) => scorecard?.reconciliation?.currencyConflicts ?? 'unknown' },
  { key: 'calls', label: 'Pozivi AI modelu', note: 'Ukupno za ovu varijantu.', get: (scorecard) => scorecard?.cost?.calls ?? 'unknown' },
  { key: 'partial', label: 'Teme s nepotpunom provjerom', note: 'Tema se broji jednom ako joj je izvorna činjenica nepotvrđena ili sažetak nije uspio. Ravni profil ne stvara tematske grupe.', get: (scorecard) => {
    const stats = scorecard?.cost?.nodeSummaryCalls;
    if (stats === 'n/a') return 'n/a';
    const partial = scorecard?.shape?.partialNodes;
    return partial ?? 'unknown';
  } },
];

function FailedFilesNote({ variants, note }) {
  const scorecards = LAB_PROFILE_ORDER
    .map((profileId) => variants?.[profileId]?.deterministicScorecard?.coverage)
    .filter(Boolean);
  const failedCount = scorecards.find((coverage) => coverage.criticalFailedDocuments != null)?.criticalFailedDocuments;
  const files = scorecards
    .map((coverage) => coverage.failedFiles)
    .find((value) => Array.isArray(value) && value.length > 0) || [];
  const fileNames = files
    .map((file) => (typeof file === 'string' ? file : file?.fileName || file?.name))
    .filter((fileName) => typeof fileName === 'string' && fileName.trim() && fileName !== 'unknown');

  return (
    <div>
      <p>{note}</p>
      {fileNames.length > 0 ? (
        <details className="mt-1">
          <summary className="cursor-pointer font-medium text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2">
            Pojedinosti o neuspjesima ({fileNames.length})
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {fileNames.map((fileName, index) => <li key={`${fileName}-${index}`}>{fileName}</li>)}
          </ul>
        </details>
      ) : failedCount !== 0 && failedCount !== 'unknown' ? (
        <p className="mt-1">Nazivi datoteka nisu dostupni.</p>
      ) : null}
    </div>
  );
}

export default function LabScorecardTable({ variants }) {
  return (
    <section aria-labelledby="lab-scorecard-title" className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <h2 id="lab-scorecard-title" className="text-lg font-semibold text-[var(--text)]">Usporedba rezultata</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Iste mjere za svaku varijantu; opisuje razlike, ne proglašava pobjednika.
        </p>
      </div>
      <p className="px-4 py-2 text-xs text-[var(--text-muted)] sm:hidden">
        Pomaknite tablicu vodoravno za usporedbu svih varijanti →
      </p>
      <div
        className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        role="region"
        aria-label="Mjere usporedbe svih varijanti; pomicanje vodoravno"
        tabIndex={0}
      >
        <table className="min-w-[760px] w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className="sticky left-0 z-10 w-[200px] bg-[var(--surface)] px-4 py-2.5 text-left font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Mjera</th>
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
              <th scope="col" className="px-4 py-2.5 text-left font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">Što ovo znači</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.key} className="border-b border-[var(--border)] last:border-0">
                <td className="sticky left-0 z-10 w-[200px] bg-[var(--surface)] px-4 py-2.5 text-left text-[var(--text)]">{row.label}</td>
                {LAB_PROFILE_ORDER.map((profileId) => {
                  const cell = formatScoreCell(row.get(variants?.[profileId]?.deterministicScorecard));
                  return (
                    <td
                      key={profileId}
                      aria-label={`${row.label}, ${profileLabel(profileId)}: ${cell.text}`}
                      title={cell.title}
                      className="px-4 py-2.5 text-right font-medium tabular-nums text-[var(--text)]"
                    >
                      {cell.text}
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 text-left align-top text-[var(--text-muted)]">
                  {row.key === 'failed'
                    ? <FailedFilesNote variants={variants} note={row.note} />
                    : row.note}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
