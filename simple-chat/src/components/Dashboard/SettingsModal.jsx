import ReasoningExperimentsPanel from './ReasoningExperimentsPanel';

function Section({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text)]">{title}</h3>
      {description ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
      ) : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function SettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Postavke"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text)]">Postavke</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zatvori"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-raised, rgba(0,0,0,0.04))] hover:text-[var(--text)]"
          >
            ✕
          </button>
        </div>

        <Section
          title="Eksperimenti zaključivanja"
          description="Uključite ili isključite pojedine korake u tijeku zaključivanja."
        >
          <ReasoningExperimentsPanel />
        </Section>
      </div>
    </div>
  );
}
