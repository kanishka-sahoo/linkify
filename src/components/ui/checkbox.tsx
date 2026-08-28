import * as React from 'react'
import { cn } from '~/lib/utils'

const Checkbox = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(({ className, ...props }, ref) => (
  <input
    type="checkbox"
    ref={ref}
    className={cn(
      'h-4 w-4 shrink-0 cursor-pointer rounded-sm border border-primary accent-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
))
Checkbox.displayName = 'Checkbox'

export { Checkbox }
