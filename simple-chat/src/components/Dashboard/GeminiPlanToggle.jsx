import { useSettings } from '../../hooks/useSettings';

const OPTIONS = [
  { value: 'free', label: 'Besplatni' },
  { value: 'paid', label: 'Plaćeni' },
];

const TOOLTIP = {
  free: 'Besplatni plan ima dnevni limit AI analize (oko 20 zahtjeva dnevno). Kad se limit potroši, analiza se pauzira do sutra.',
  paid: 'Plaćeni plan omogućuje više zahtjeva i automatske ponovne pokušaje kad je servis privremeno preopterećen.',
};

export default function GeminiPlanToggle() {
  const { geminiPlan, saving, error, saveGeminiPlan } = useSettings();

  const handleChange = async (value) => {
    if (value === geminiPlan || saving) return;
    try {
      await saveGeminiPlan(value);
    } catch {
      // Save errors surface via the hook's `error` and keep the prior selection.
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="group relative">
        <span
          className="flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[var(--border)] text-[11px] leading-none text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
          aria-hidden="true"
        >
          ?
        </span>
        <div
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-60 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-relaxed text-[var(--text-muted)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
        >
          {TOOLTIP[geminiPlan] || TOOLTIP.free}
        </div>
      </div>

      <div
        role="radiogroup"
        aria-label="AI plan"
        className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={geminiPlan === option.value}
            disabled={saving}
            onClick={() => handleChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              geminiPlan === option.value
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            } disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <span className="text-xs text-[var(--danger, #ef4444)]">{error}</span>
      ) : null}
    </div>
  );
}
