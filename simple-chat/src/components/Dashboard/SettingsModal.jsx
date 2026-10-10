import Dialog from '../ui/Dialog';
import ReasoningExperimentsPanel from './ReasoningExperimentsPanel';

export default function SettingsModal({ isOpen, onClose }) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Postavke"
      description="Primjenjuju se na sljedeću analizu."
      size="lg"
    >
      <section aria-labelledby="reasoning-experiments-title">
        <h3 id="reasoning-experiments-title" className="text-sm font-semibold text-[var(--text)]">
          Eksperimenti zaključivanja
        </h3>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Uključite ili isključite pojedine korake u tijeku zaključivanja.
        </p>
        <div className="mt-4">
          <ReasoningExperimentsPanel />
        </div>
      </section>
    </Dialog>
  );
}
