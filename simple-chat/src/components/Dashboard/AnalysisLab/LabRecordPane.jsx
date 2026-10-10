import { shortHash, profileLabel, formatLabDeltas } from './labMeta';

const row = (label, value) => (
  <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
    <dt className="text-[var(--text-muted)]">{label}</dt>
    <dd className="break-all text-[var(--text)]">{value}</dd>
  </div>
);

export default function LabRecordPane({ experiment, comparison }) {
  if (!experiment) {
    return <p className="text-sm text-[var(--text-muted)]">Zapis nije dostupan.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section aria-label="Nepromjenjivi zapis usporedbe" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <h3 className="border-b border-[var(--border)] px-4 py-2.5 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
          Nepromjenjivi zapis usporedbe
        </h3>
        <dl className="space-y-2 px-4 py-3 font-mono text-xs">
          {row('eksperiment', experiment.id)}
          {row('status', experiment.status)}
          {row('ulaz', experiment.evidencePackageRef)}
          {row('hash paketa', shortHash(experiment.evidencePackageHash))}
          {row('hash odgovara', comparison?.inputHashMatches === true ? 'da' : comparison?.inputHashMatches === false ? 'ne' : '?')}
          {row('profili', (experiment.profiles || []).map(profileLabel).join(' · '))}
          {row('stvoreno', experiment.createdAt || '?')}
          {row('dovršeno', experiment.completedAt || '—')}
        </dl>
      </section>

      <section aria-label="Kako čitati ovaj zaslon" className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <h3 className="border-b border-[var(--border)] px-4 py-2.5 font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
          Kako čitati ovaj zaslon
        </h3>
        <div className="border-l-2 border-[var(--border)] px-4 py-3 text-sm leading-relaxed text-[var(--text)]">
          <p><strong>Ovo nije automatsko ocjenjivanje.</strong></p>
          <p className="mt-2 text-[var(--text-muted)]">
            Pregledajte izvještaje pa otvorite izvorne odlomke ondje gdje se razlikuju nalazi.
            Mjere prikazuju koliko je izvora povezano, što nije moglo biti grupirano i koji su dijelovi nepotpuni.
            Ne određuju koji je izvještaj „bolji“.
          </p>
          {Array.isArray(comparison?.flatToDag?.deltas) && comparison.flatToDag.deltas.length > 0 && (
            <p className="mt-2 text-[var(--text-muted)]">
              Bez grupiranja → Tematske grupe: {formatLabDeltas(comparison.flatToDag.deltas, '')}
            </p>
          )}
          {Array.isArray(comparison?.dagToSummarized?.deltas) && comparison.dagToSummarized.deltas.length > 0 && (
            <p className="mt-1 text-[var(--text-muted)]">
              Tematske grupe → Grupe sa sažecima: {formatLabDeltas(comparison.dagToSummarized.deltas, '')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
