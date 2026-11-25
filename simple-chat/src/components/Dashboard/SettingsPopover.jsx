import * as Popover from '@radix-ui/react-popover';
import { useSettings } from '../../hooks/useSettings';
import ScanDepthSelect from './ScanDepthSelect';

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function SettingsPopover() {
  const { settings, loading, saving, error, saveSettings } = useSettings();
  const defaultScanDepth = settings.defaultScanDepth || 'balanced';

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Postavke"
          title="Postavke"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <GearIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          aria-labelledby="settings-popover-title"
          className="z-[130] w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[var(--text)] shadow-lg outline-none"
        >
          <div className="mb-4">
            <h2 id="settings-popover-title" className="text-sm font-semibold">
              Postavke
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
              Zadana dubina pretrage za nove analize.
            </p>
          </div>
          <ScanDepthSelect
            value={defaultScanDepth}
            disabled={loading || saving}
            onChange={(value) => saveSettings({ defaultScanDepth: value }).catch(() => {})}
          />
          {saving ? <p role="status" className="mt-2 text-xs text-[var(--text-muted)]">Spremanje…</p> : null}
          {error ? <p role="alert" className="mt-2 text-xs text-[var(--error)]">{error}</p> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
