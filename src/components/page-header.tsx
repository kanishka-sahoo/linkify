import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

/** Title row shared by every dashboard page: heading and summary on the left, actions on the right. */
export function PageHeader({ title, description, actions, className }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  )
}

/** One cell of a joined stat strip; place several inside a `StatGrid`. */
export function Stat({ label, value, hint, className }: {
  label: ReactNode
  value: number
  hint?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid content-start gap-1 bg-card p-4 sm:p-5', className)}>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value.toLocaleString('en-US')}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export function StatGrid({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm', className)}>
      {children}
    </section>
  )
}

/** Bordered surface with an optional title bar; the building block for dashboard panels. */
export function Panel({ title, description, actions, className, bodyClassName, children }: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cn('overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div className="grid min-w-0 gap-1">
            {title && <h2 className="font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn('p-5', bodyClassName)}>{children}</div>
    </section>
  )
}
