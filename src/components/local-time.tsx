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
  const full = hydrated ? date.toLocaleString() : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
  const short = hydrated ? date.toLocaleDateString() : iso.slice(0, 10)
  return <time dateTime={iso} title={withTitle ? full : undefined}>{dateOnly ? short : full}</time>
}
