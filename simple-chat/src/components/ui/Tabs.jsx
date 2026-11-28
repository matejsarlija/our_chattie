import { createContext, useContext, useId, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

const TabsContext = createContext(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) {
    throw new Error('Tabs components must be rendered inside <Tabs>');
  }
  return ctx;
}

export function Tabs({ value, defaultValue, onValueChange, className, children, ...props }) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue ?? '');
  const baseId = useId();
  const isControlled = value !== undefined;
  const activeValue = isControlled ? value : uncontrolledValue;

  const setActiveValue = (next) => {
    if (!isControlled) {
      setUncontrolledValue(next);
    }
    onValueChange?.(next);
  };

  return (
    <TabsContext.Provider value={{ activeValue, setActiveValue, baseId }}>
      <div className={cn('w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children, ...props }) {
  const listRef = useRef(null);

  const handleKeyDown = (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const listEl = listRef.current;
    if (!listEl) return;
    const tabs = Array.from(listEl.querySelectorAll('[role="tab"]:not([disabled])'));
    if (tabs.length === 0) return;

    const currentIndex = tabs.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    nextTab.focus();
    nextTab.click();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cn('flex flex-wrap items-center gap-1 pb-2 sm:flex-nowrap sm:overflow-x-auto sm:border-b sm:border-line sm:pb-0', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({ value, className, children, disabled = false, ...props }) {
  const { activeValue, setActiveValue, baseId } = useTabsContext();
  const isActive = activeValue === value;
  const tabId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={isActive}
      aria-controls={panelId}
      tabIndex={isActive ? 0 : -1}
      disabled={disabled}
      onClick={() => setActiveValue(value)}
      className={cn(
        'relative shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors sm:-mb-px sm:rounded-none sm:border-b-2 sm:px-3.5 sm:py-2.5 sm:text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45',
        isActive
          ? 'bg-info-surface text-accent sm:border-accent sm:bg-transparent sm:text-ink'
          : 'text-ink-muted hover:bg-surface-muted hover:text-ink sm:border-transparent sm:hover:bg-transparent',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, className, children, ...props }) {
  const { activeValue, baseId } = useTabsContext();
  if (activeValue !== value) return null;

  const tabId = `${baseId}-tab-${value}`;
  const panelId = `${baseId}-panel-${value}`;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      tabIndex={0}
      className={cn('pt-4 outline-none', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export default Tabs;
