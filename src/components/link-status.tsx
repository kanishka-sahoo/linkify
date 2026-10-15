import type { ReactNode } from 'react'
import { getLinkAvailability, type SafeLink } from '~/lib/link-domain'
import { LocalTime } from '~/components/local-time'
import { cn } from '~/lib/utils'

export type LinkState = ReturnType<typeof getLinkAvailability>['state']

/** Presentation for each lifecycle state; `summary` is what a visitor experiences. */
export const LINK_STATES: Record<LinkState, { label: string; tone: string; dot: string; summary: string }> = {
  active: {
    label: 'Active',
    tone: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-400 dark:ring-emerald-400/20',
    dot: 'bg-emerald-500',
    summary: 'Visitors are redirected to the destination.',
  },
  scheduled: {
    label: 'Scheduled',
    tone: 'bg-sky-500/10 text-sky-700 ring-sky-600/20 dark:text-sky-400 dark:ring-sky-400/20',
    dot: 'bg-sky-500',
    summary: "Not live yet — it starts redirecting at the scheduled time.",
  },
  paused: {
    label: 'Paused',
    tone: 'bg-amber-500/10 text-amber-700 ring-amber-600/25 dark:text-amber-400 dark:ring-amber-400/20',
    dot: 'bg-amber-500',
    summary: 'Paused by its owner, so it isn’t redirecting visitors.',
  },
  expired: {
    label: 'Expired',
    tone: 'bg-rose-500/10 text-rose-700 ring-rose-600/20 dark:text-rose-400 dark:ring-rose-400/20',
    dot: 'bg-rose-500',
    summary: 'Past its expiry time, so it no longer redirects.',
  },
  'limit-reached': {
    label: 'Limit reached',
    tone: 'bg-orange-500/10 text-orange-700 ring-orange-600/20 dark:text-orange-400 dark:ring-orange-400/20',
    dot: 'bg-orange-500',
    summary: 'Used up its click limit, so it no longer redirects.',
  },
}

export const linkState = (link: SafeLink): LinkState => getLinkAvailability(link).state

export function StatusBadge({ state, className }: { state: LinkState; className?: string }) {
  const { label, tone, dot } = LINK_STATES[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', tone, className)}>
      <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  )
}

/** The one timing fact that matters most for the link's current state, e.g. "Expires 1 Jan 2028". */
export function StateNote({ link, state }: { link: SafeLink; state: LinkState }) {
  let note: ReactNode = null
  if (state === 'scheduled' && link.startsAt) note = <>Starts <LocalTime value={link.startsAt} dateOnly withTitle /></>
  else if (state === 'expired' && link.expiresAt) note = <>Ended <LocalTime value={link.expiresAt} dateOnly withTitle /></>
  else if (state === 'limit-reached' && link.maxClicks) note = <>{link.maxClicks.toLocaleString('en-US')} click cap</>
  else if (link.expiresAt) note = <>Expires <LocalTime value={link.expiresAt} dateOnly withTitle /></>
  if (!note) return null
  return <span className="whitespace-nowrap text-xs text-muted-foreground">{note}</span>
}

/** Click count, plus a usage meter when the link has a click limit. */
export function ClickUsage({ count, max, className }: { count: number; max: number | null; className?: string }) {
  if (!max) {
    return <span className={cn('font-medium tabular-nums', className)}>{count.toLocaleString('en-US')}</span>
  }
  const pct = Math.min(100, (count / max) * 100)
  return (
    <div className={cn('grid w-24 gap-1', className)} title={`${count.toLocaleString('en-US')} of ${max.toLocaleString('en-US')} allowed clicks used`}>
      <span className="text-sm tabular-nums">
        <span className="font-medium">{count.toLocaleString('en-US')}</span>
        <span className="text-muted-foreground"> / {max.toLocaleString('en-US')}</span>
      </span>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={count} aria-label="Click limit used"
      >
        <div
          className={cn('h-full rounded-full', pct >= 100 ? 'bg-orange-500' : pct >= 80 ? 'bg-amber-500' : 'bg-foreground/70')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** "linkedin.com/in/someone" — the destination without the noise of protocol and trailing slash. */
export function displayUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
}
