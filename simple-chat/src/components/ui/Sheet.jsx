import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';

const SIZE_CLASS = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
};

export default function Sheet({
  open,
  isOpen,
  onOpenChange,
  onClose,
  title,
  description,
  size = 'md',
  children,
  className,
}) {
  const resolvedOpen = open !== undefined ? open : Boolean(isOpen);
  const handleOpenChange = (nextOpen) => {
    onOpenChange?.(nextOpen);
    if (!nextOpen) onClose?.();
  };

  return (
    <DialogPrimitive.Root open={resolvedOpen} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[120] bg-ink/20" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-[121] flex w-full flex-col border-l border-line-control bg-surface shadow-xl outline-none',
            SIZE_CLASS[size] || SIZE_CLASS.md,
            className,
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold leading-6 text-ink">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm leading-5 text-ink-muted">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Zatvori preglednik"
                className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lg leading-none text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                ×
              </button>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
