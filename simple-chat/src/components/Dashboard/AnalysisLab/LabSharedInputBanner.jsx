import { shortHash } from './labMeta';

export default function LabSharedInputBanner({ evidencePackageHash, inputSummary, match }) {
  const hashOk = match === true;
  const hashBad = match === false;

  return (
    <section
      aria-label="Zajednički zamrznuti ulaz"
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-lg text-[var(--text-muted)]"
        >
          =
        </div>
        <div className="min-w-0 flex-1">
          <strong className="block text-[var(--text)]">Isti zamrznuti paket dokaza</strong>
          <span className="mt-0.5 block font-mono text-xs text-[var(--text-muted)]">
            {[inputSummary?.caseNumber, inputSummary?.documents != null ? `${inputSummary.documents} dokumenata` : null]
              .filter(Boolean)
              .join(' · ') || 'Nepoznat paket'}
          </span>
        </div>
        <div
          aria-label={hashOk ? 'Hash ulaza odgovara' : hashBad ? 'Hash ulaza se ne podudara' : 'Status hasha nepoznat'}
          className="font-mono text-xs text-[var(--text-muted)]"
        >
          SHA-256 <b className="font-medium text-[var(--text)]">{shortHash(evidencePackageHash)}</b>
          {' '}
          {hashOk && <span className="text-emerald-700">✓ hash odgovara</span>}
          {hashBad && <span className="text-amber-700">⚠ hash se ne podudara</span>}
          {match !== true && match !== false && <span>? status nepoznat</span>}
        </div>
      </div>
    </section>
  );
}
