import { useHydrated } from '@tanstack/react-router'

/**
 * A timestamp in the viewer's locale and timezone. The server can't know
 * either, so SSR and the hydration render show a fixed UTC form and the
 * local form replaces it after hydration (#1).
 */
export function LocalTime({ value, dateOnly = false, withTitle = false }: {
  value: Date | string
  dateOnly?: boolean
  /** Show the full date and time on hover. */
  withTitle?: boolean
}) {
  const hydrated = useHydrated()
  const date = new Date(value)
  const iso = date.toISOString()
  const full = hydrated
    ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
  const short = hydrated ? date.toLocaleDateString(undefined, { dateStyle: 'medium' }) : iso.slice(0, 10)
  return <time dateTime={iso} title={withTitle ? full : undefined}>{dateOnly ? short : full}</time>
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60_000],
  ['month', 30 * 24 * 60 * 60_000],
  ['week', 7 * 24 * 60 * 60_000],
  ['day', 24 * 60 * 60_000],
  ['hour', 60 * 60_000],
  ['minute', 60_000],
]

/** "in 3 months", "2 days ago". Depends on the current time, so it renders nothing until hydrated. */
export function RelativeTime({ value }: { value: Date | string }) {
  const hydrated = useHydrated()
  if (!hydrated) return null
  const diff = new Date(value).getTime() - Date.now()
  const [unit, ms] = RELATIVE_UNITS.find(([, ms]) => Math.abs(diff) >= ms) ?? ['minute', 60_000]
  const text = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(diff / ms), unit)
  return <>{text}</>
}
