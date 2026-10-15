import * as React from 'react'
import { cn } from '~/lib/utils'

/** An on/off toggle built on a checkbox, so it works in plain forms and with labels. */
const Switch = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => (
    <span className={cn('relative inline-flex h-5 w-9 shrink-0', className)}>
      <input ref={ref} type="checkbox" role="switch" className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed" {...props} />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none h-full w-full rounded-full bg-input transition-colors peer-checked:bg-primary',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
          'peer-disabled:opacity-50',
          'after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-background after:shadow-sm after:transition-transform',
          'peer-checked:after:translate-x-4',
        )}
      />
    </span>
  ),
)
Switch.displayName = 'Switch'

export { Switch }
