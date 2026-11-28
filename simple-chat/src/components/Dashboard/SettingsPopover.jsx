import * as Popover from '@radix-ui/react-popover';
import { Link } from 'react-router-dom';

function GearIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.4 2.2h3.2l.45 2.3a7.7 7.7 0 0 1 1.85.77l1.9-1.33 2.26 2.26-1.33 1.9c.33.58.59 1.2.77 1.85l2.3.45v3.2l-2.3.45a7.7 7.7 0 0 1-.77 1.85l1.33 1.9-2.26 2.26-1.9-1.33a7.7 7.7 0 0 1-1.85.77l-.45 2.3h-3.2l-.45-2.3a7.7 7.7 0 0 1-1.85-.77l-1.9 1.33-2.26-2.26 1.33-1.9a7.7 7.7 0 0 1-.77-1.85l-2.3-.45v-3.2l2.3-.45c.18-.65.44-1.27.77-1.85l-1.33-1.9 2.26-2.26 1.9 1.33c.58-.33 1.2-.59 1.85-.77l.45-2.3ZM12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"
      />
    </svg>
  );
}

const POPOVER_LINKS = [
  { to: '/dashboard/design-system', label: 'Design System' },
  { to: '/pravila-privatnosti', label: 'Pravila privatnosti' },
  { to: '/o-nama', label: 'O nama' },
];

export default function SettingsPopover() {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Postavke"
          title="Postavke"
          className="flex h-10 w-10 items-center justify-center rounded-full text-line-control transition-all hover:bg-surface-muted hover:text-ink-muted hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <GearIcon />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          side="top"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Dodatne stranice"
          className="z-[130] w-52 rounded-lg border border-line bg-surface p-1.5 text-ink shadow-lg outline-none"
        >
          <nav aria-label="Dodatne stranice" className="flex flex-col gap-0.5">
            {POPOVER_LINKS.map((item) => (
              <Popover.Close asChild key={item.to}>
                <Link
                  to={item.to}
                  className="rounded-md px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                >
                  {item.label}
                </Link>
              </Popover.Close>
            ))}
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
