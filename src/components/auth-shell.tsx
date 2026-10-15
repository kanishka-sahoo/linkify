import { Link } from '@tanstack/react-router'
import { Link2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { ThemeToggle } from '~/components/theme-toggle'

export function BrandMark({ className = 'size-8' }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm ${className}`}>
      <Link2 className="size-[55%]" />
    </span>
  )
}

/** Frame for the signed-out pages: brand bar, a faint dotted backdrop, and the content centered. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-muted/30 dark:bg-background">
      <div aria-hidden className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <header className="relative flex h-16 items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2 rounded-md font-semibold tracking-tight">
          <BrandMark className="size-7" />
          Linkify
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-4 pb-16 pt-4">{children}</main>
    </div>
  )
}

/** The card the sign-in and setup forms sit in. */
export function AuthCard({ title, description, children, footer }: {
  title: ReactNode
  description: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="w-full max-w-sm motion-safe:animate-rise-in">
      <div className="rounded-2xl border bg-card p-6 text-card-foreground shadow-xl shadow-black/[0.03] sm:p-8 dark:shadow-none">
        <div className="mb-6 grid gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
      {footer && <div className="mt-4 text-center text-xs text-muted-foreground">{footer}</div>}
    </div>
  )
}
