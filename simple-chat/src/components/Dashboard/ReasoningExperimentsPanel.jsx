import { useSettings } from '../../hooks/useSettings';

const RERANK_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'force', label: 'Prisilno' },
  { value: 'off', label: 'Isklj.' },
];

const ON_OFF_OPTIONS = [
  { value: 'on', label: 'Uklj.' },
  { value: 'off', label: 'Isklj.' },
];

const TOOLTIPS = {
  rerank: {
    auto: 'Automatski: model preuređuje pronađene dokaze samo kad su rezultati pretraživanja dvosmisleni (1 poziv po analizi).',
    force: 'Prisilno: model preuređuje dokaze na svakoj analizi, neovisno o dvosmislenosti. Korisno za provjeru — troši kvotu.',
    off: 'Preuređivanje dokaza je isključeno. Rezultati se rangiraju isključivo leksički.',
  },
  planner: {
    on: 'Model generira ciljane upite za pretraživanje na temelju inventara predmeta (1 mali poziv po analizi). Mjereno: fiksni upiti pogađaju samo ~13% stvarnog sadržaja.',
    off: 'Fiksni predlošci upita bez planiranja. Bez dodatnih poziva.',
  },
  followUp: {
    on: 'Kad analiza pronađe konflikte, izvorni dokumenti se dohvaćaju i konflikti se provjeravaju jednim dodatnim pozivom.',
    off: 'Konflikti se prikazuju bez dodatne provjere protiv izvornih dokumenata.',
  },
};

function Tooltip({ text }) {
  return (
    <div className="group relative">
      <span
        className="flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[var(--border)] text-[11px] leading-none text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text)]"
        aria-hidden="true"
      >
        ?
      </span>
      <div
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-xs leading-relaxed text-[var(--text-muted)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        {text}
      </div>
    </div>
  );
}

function SegmentedControl({ options, value, onSelect, disabled, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onSelect(option.value)}
          className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
            value === option.value
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SettingRow({ label, tooltip, children }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--text)]">{label}</span>
        <Tooltip text={tooltip} />
      </div>
      {children}
    </div>
  );
}

/**
 * Reasoning experiment switches (rerank / query planner / conflict re-verify).
 * Persisted via /api/settings; applies to the NEXT analysis run — no restart.
 */
export default function ReasoningExperimentsPanel() {
  const {
    reasoningRerankMode,
    reasoningPlanner,
    reasoningFollowUp,
    saving,
    error,
    saveReasoningSettings,
  } = useSettings();

  const handleChange = (patch) => {
    if (saving) return;
    saveReasoningSettings(patch).catch(() => {
      // Save errors surface via the hook's `error` and keep the prior selection.
    });
  };

  return (
    <div className="space-y-4" data-testid="reasoning-experiments-panel">
      <SettingRow
        label="Rerank dokaza"
        tooltip={TOOLTIPS.rerank[reasoningRerankMode] || TOOLTIPS.rerank.auto}
      >
        <SegmentedControl
          label="Rerank dokaza"
          options={RERANK_OPTIONS}
          value={reasoningRerankMode}
          onSelect={(value) => handleChange({ reasoningRerankMode: value })}
          disabled={saving}
        />
      </SettingRow>

      <SettingRow
        label="Planiranje upita"
        tooltip={TOOLTIPS.planner[reasoningPlanner] || TOOLTIPS.planner.on}
      >
        <SegmentedControl
          label="Planiranje upita"
          options={ON_OFF_OPTIONS}
          value={reasoningPlanner}
          onSelect={(value) => handleChange({ reasoningPlanner: value })}
          disabled={saving}
        />
      </SettingRow>

      <SettingRow
        label="Re-verifikacija konflikata"
        tooltip={TOOLTIPS.followUp[reasoningFollowUp] || TOOLTIPS.followUp.on}
      >
        <SegmentedControl
          label="Re-verifikacija konflikata"
          options={ON_OFF_OPTIONS}
          value={reasoningFollowUp}
          onSelect={(value) => handleChange({ reasoningFollowUp: value })}
          disabled={saving}
        />
      </SettingRow>

      {error ? <span className="text-xs text-[var(--danger, #ef4444)]">{error}</span> : null}
    </div>
  );
}
