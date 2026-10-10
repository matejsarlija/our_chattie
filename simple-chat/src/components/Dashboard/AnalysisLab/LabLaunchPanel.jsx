import { useState } from 'react';
import { useLabPackages } from '../../../hooks/useLabPackages';
import { useCreateLabExperiment } from '../../../hooks/useCreateLabExperiment';

export default function LabLaunchPanel({ onCreated }) {
  const { packages, loading: packagesLoading, error: packagesError, reload } = useLabPackages();
  const { createExperiment, creating, createError } = useCreateLabExperiment();
  const [selectedRef, setSelectedRef] = useState('');

  const selected = packages.find((pkg) => pkg.ref === selectedRef) || null;

  const handleLaunch = async () => {
    const result = await createExperiment({ evidencePackageRef: selectedRef });
    if (result?.experiment?.id && typeof onCreated === 'function') {
      onCreated(result.experiment.id);
    }
  };

  return (
    <section aria-labelledby="lab-launch-title" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 id="lab-launch-title" className="text-lg font-semibold text-[var(--text)]">
        Pokreni usporedbu
      </h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Odaberite spremljeni paket. Sva tri profila koriste isti zamrznuti ulaz i zajedničke rezultate dohvaćanja dokaza.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor="lab-package-select" className="block font-mono text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Ulazni paket
          </label>
          <select
            id="lab-package-select"
            aria-label="Odaberi spremljeni paket"
            value={selectedRef}
            onChange={(event) => setSelectedRef(event.target.value)}
            disabled={packagesLoading || creating}
            className="mt-1.5 block w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text)]"
          >
            <option value="">{packagesLoading ? 'Učitavam pakete…' : 'Odaberite paket…'}</option>
            {packages.map((pkg) => (
              <option key={pkg.ref} value={pkg.ref}>
                {(pkg.kind === 'fixture' ? 'Fixture' : 'Analiza')} · {pkg.inputSummary?.caseNumber || pkg.ref} · {pkg.inputSummary?.documents ?? '?'} dokumenata
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleLaunch}
          disabled={!selectedRef || creating}
          className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {creating ? 'Pokrećem…' : 'Pokreni usporedbu →'}
        </button>
      </div>

      {(packagesError || createError) && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {createError || packagesError}
          {packagesError && (
            <button type="button" onClick={reload} className="ml-3 underline">
              Pokušaj ponovno
            </button>
          )}
        </div>
      )}

      <div className="mt-4 border-t border-[var(--border)] pt-3 font-mono text-xs leading-relaxed text-[var(--text-muted)]">
        <b className="font-medium text-[var(--text)]">Profili:</b> baseline-flat-v1 · context-tree-v1 (sažeci isključeni) · context-tree-summarized-v1 (sažeci uključeni, do 4 poziva)
        {selected && (
          <>
            <br />
            <b className="font-medium text-[var(--text)]">Paket:</b> {selected.inputSummary?.caseNumber || selected.ref} · {selected.inputSummary?.documents ?? '?'} dokumenata
          </>
        )}
        <br />
        <b className="font-medium text-[var(--text)]">Zajednički ulaz:</b> dohvaćanje i savjetodavna obrada izvršavaju se jednom.
      </div>
    </section>
  );
}
