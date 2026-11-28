import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Input = forwardRef(function Input({ className, type = 'text', ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
});

export default Input;
