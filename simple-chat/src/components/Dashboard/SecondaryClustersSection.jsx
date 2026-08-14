const IDENTITY_LABELS = {
  consistent: 'Identičan subjekt',
  ambiguous: 'Nejasna identifikacija',
};

export default function SecondaryClustersSection({ clusters = [] }) {
  if (!Array.isArray(clusters) || clusters.length === 0) return null;

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">Ostali pronađeni predmeti</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Ovaj upit je otkrio i dodatne predmete koji nisu uključeni u odabranu analizu. Za potpunu sliku
            istražite ih zasebno.
          </p>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs font-medium text-[var(--text)]">
          {clusters.length} predmeta
        </span>
      </div>
      <div className="space-y-2">
        {clusters.map((cluster) => {
          const clusterId = cluster?.clusterId || cluster?.caseNumber || '-';
          const identity = IDENTITY_LABELS[cluster?.identityConsistency] || 'Nepotvrđena identifikacija';
          return (
            <article key={clusterId} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text)]">{clusterId}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {cluster.entryCount ?? 0} objava · {cluster.documentCount ?? 0} dokumenata ·{' '}
                    {cluster.participantNames?.length ? cluster.participantNames.join(', ') : 'Bez sudionika'}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                  {identity}
                </span>
              </div>
              {Array.isArray(cluster.acquisitionProvenance) && cluster.acquisitionProvenance.length > 0 && (
                <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                  Pronađeno: {cluster.acquisitionProvenance.map((p) => p.mode).filter(Boolean).join(', ')}
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
