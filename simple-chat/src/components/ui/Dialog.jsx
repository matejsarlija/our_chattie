import { useRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '../../lib/utils';

export default function Dialog({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  initialFocusRef,
  children,
  className,
}) {
  const previouslyFocusedRef = useRef(null);

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-[3px]" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-[121] flex max-h-[min(90vh,48rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl border border-[var(--border-control)] bg-[var(--surface)] shadow-xl outline-none',
            size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-xl' : 'max-w-lg',
            className,
          )}
          onOpenAutoFocus={(event) => {
            previouslyFocusedRef.current = document.activeElement;
            if (initialFocusRef?.current) {
              event.preventDefault();
              initialFocusRef.current.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            const previouslyFocused = previouslyFocusedRef.current;
            if (previouslyFocused?.isConnected) {
              event.preventDefault();
              previouslyFocused.focus();
            }
          }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold leading-6 text-[var(--text)]">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm leading-5 text-[var(--text-muted)]">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Zatvori dijalog"
                className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg leading-none text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                ×
              </button>
            </DialogPrimitive.Close>
          </header>
          <div className="min-h-0 flex-1 px-6 py-5">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
