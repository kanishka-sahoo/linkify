import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

/** A row of mutually exclusive buttons on a muted track, e.g. a date range or status filter. */
export function Segmented<T extends string | number>({ value, options, onChange, label, className }: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex gap-0.5 rounded-lg border bg-muted/60 p-0.5', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
