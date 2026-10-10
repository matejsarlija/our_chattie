import LabStatusBadge from './LabStatusBadge';

const formatDate = (iso) => {
  if (!iso) return '-';
  try {
    return new Intl.DateTimeFormat('hr-HR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return String(iso);
  }
};

export default function LabExperimentList({ experiments, onOpen }) {
  if (!Array.isArray(experiments) || experiments.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
        <p className="text-[var(--text)]">Nema spremljenih usporedbi.</p>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Pokrenite prvu usporedbu odabirom paketa iznad.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3" aria-label="Spremljene usporedbe">
      {experiments.map((experiment) => (
        <li key={experiment.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--text)]">
                {experiment.inputSummary?.caseNumber || experiment.evidencePackageRef} · {formatDate(experiment.createdAt)}
              </p>
              <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
                {experiment.evidencePackageRef} · {(experiment.profiles || []).length} profila
              </p>
            </div>
            <div className="flex items-center gap-3">
              <LabStatusBadge status={experiment.status} />
              <button
                type="button"
                onClick={() => onOpen?.(experiment.id)}
                aria-label={`Otvori usporedbu ${experiment.inputSummary?.caseNumber || experiment.id}`}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--surface-muted)] focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Otvori →
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
