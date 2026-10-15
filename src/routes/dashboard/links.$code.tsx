import { Link, createFileRoute, useNavigate, useRouteContext, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeft, Bot, Copy, Download, ExternalLink, EyeOff, Lock, Pencil, QrCode, User } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { deleteLink, getClickLog, getLinkStats } from '~/lib/links'
import { CLICK_OUTCOMES, type ClickOutcome, type NamedCount } from '~/lib/click-stats'
import { countryLabel, percentLabel, referrerLabel } from '~/lib/click-labels'
import type { ClickLogFilter } from '~/lib/click-log'
import { Checkbox } from '~/components/ui/checkbox'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { NotFound, RouteError } from '~/components/route-status'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { LocalTime } from '~/components/local-time'
import { Select } from '~/components/ui/select'
import { Segmented } from '~/components/ui/segmented'
import { LinkSettings } from '~/components/link-details'
import { LinkEditorSheet } from '~/components/link-form'
import { LinkQrDialog } from '~/components/link-qr-dialog'
import { Panel, Stat, StatGrid } from '~/components/page-header'
import { StatusBadge, displayUrl, linkState } from '~/components/link-status'
import { cn } from '~/lib/utils'

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
]

export const Route = createFileRoute('/dashboard/links/$code')({
  loader: async ({ params }) => {
    const [stats, log] = await Promise.all([
      getLinkStats({ data: { code: params.code, days: 30 } }),
      getClickLog({ data: { code: params.code } }),
    ])
    return { stats, log }
  },
  component: AnalyticsPage,
  notFoundComponent: () => <NotFound text="This link doesn't exist, or you don't have access to it." />,
  errorComponent: RouteError,
})

const OUTCOME_LABELS: Record<ClickOutcome, string> = {
  redirected: 'Redirected',
  fallback: 'Sent to fallback URL',
  blocked: 'Blocked (link inactive)',
  password_failed: 'Wrong password',
}

const seriesConfig = {
  count: { label: 'Clicks', color: 'var(--chart-2)' },
  unique: { label: 'Unique humans', color: 'var(--chart-1)' },
} satisfies ChartConfig

function AnalyticsPage() {
  const router = useRouter()
  const navigate = useNavigate()
  const { user } = useRouteContext({ from: '/dashboard' })
  const readOnly = user.role === 'guest'
  const initial = Route.useLoaderData()
  const { code } = Route.useParams()
  const [days, setDays] = useState(30)
  const [data, setData] = useState(initial.stats)
  const [loading, setLoading] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [qrFor, setQrFor] = useState<string | null>(null)

  // A reload (after an edit, or a rename to a new code) starts again from the loader's 30-day window.
  useEffect(() => {
    setData(initial.stats)
    setDays(30)
  }, [initial.stats])

  const { link, series, byCountry, byReferrer, byBrowser, byOs, byDevice, human, bots, uniqueVisitors, outcomes } = data
  const total = human + bots
  const state = linkState(link)

  async function changeRange(d: number) {
    setDays(d)
    setLoading(true)
    setData(await getLinkStats({ data: { code, days: d } }))
    setLoading(false)
  }

  function onSaved(saved: typeof link) {
    if (saved.code !== code) navigate({ to: '/dashboard/links/$code', params: { code: saved.code }, replace: true })
    else router.invalidate()
  }

  async function onDelete() {
    if (!confirm(`Delete /${link.code}? This also deletes its analytics.`)) return
    await deleteLink({ data: { id: link.id } })
    toast.success('Link deleted')
    navigate({ to: '/dashboard' })
  }

  const labelled = (rows: NamedCount[], label = (name: string | null) => name ?? 'Unknown') =>
    rows.map((r) => ({ label: label(r.name), count: r.count }))

  return (
    <div className="grid grid-cols-1 gap-6">
      <Link
        to="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" /> Links
      </Link>

      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate font-mono text-2xl font-semibold tracking-tight">/{link.code}</h1>
            <StatusBadge state={state} />
            {link.passwordProtected && (
              <Badge variant="outline" className="gap-1 rounded-full font-medium text-muted-foreground"><Lock className="size-3" /> Password</Badge>
            )}
            {link.privacyEnabled && (
              <Badge variant="outline" className="gap-1 rounded-full font-medium text-muted-foreground"><EyeOff className="size-3" /> Privacy mode</Badge>
            )}
          </div>
          {link.title && <p className="text-sm font-medium">{link.title}</p>}
          <a
            href={link.url} target="_blank" rel="noreferrer" title={link.url}
            className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
          >
            <span aria-hidden className="shrink-0 text-muted-foreground/60">↳</span>
            <span className="truncate">{displayUrl(link.url)}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="outline" className="bg-background"
            onClick={async () => {
              await navigator.clipboard.writeText(`${window.location.origin}/${link.code}`)
              toast.success('Short link copied')
            }}
          >
            <Copy /> Copy
          </Button>
          <Button variant="outline" className="bg-background" onClick={() => setQrFor(link.code)}>
            <QrCode /> QR code
          </Button>
          {!readOnly && (
            <Button onClick={() => setEditorOpen(true)}>
              <Pencil /> Edit link
            </Button>
          )}
        </div>
      </header>

      <div className={cn('grid grid-cols-1 gap-6 transition-opacity', loading && 'opacity-60')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
          <Segmented
            label="Date range"
            value={days}
            onChange={changeRange}
            options={RANGES.map((r) => ({ value: r.days, label: r.label }))}
          />
        </div>

        <StatGrid label="Totals" className="sm:grid-cols-5">
          <Stat className="col-span-2 sm:col-span-1" label="Total clicks" value={link.clickCount} hint="All time" />
          <Stat label="Clicks" value={total} hint={`Last ${days} days`} />
          <Stat label="Humans" value={human} hint={percentHint(human, total)} />
          <Stat label="Unique humans" value={uniqueVisitors} hint={`Last ${days} days`} />
          <Stat label="Bots" value={bots} hint={percentHint(bots, total)} />
        </StatGrid>

        <Panel
          title="Clicks over time"
          actions={
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <LegendDot color="var(--chart-2)" label="Clicks" />
              <LegendDot color="var(--chart-1)" label="Unique humans" />
            </div>
          }
        >
          {series.every((p) => p.count === 0) ? (
            <Empty text="No clicks in this period." />
          ) : (
            <ChartContainer config={seriesConfig} className="h-[260px] w-full">
              <AreaChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
                <defs>
                  <linearGradient id="fill-count" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="count" stroke="var(--color-count)" fill="url(#fill-count)" strokeWidth={2} />
                <Area type="monotone" dataKey="unique" stroke="var(--color-unique)" fill="var(--color-unique)" fillOpacity={0.06} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          )}
        </Panel>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BarListCard title="Countries" total={total} rows={labelled(byCountry, countryLabel)} />
          <BarListCard title="Referrers" total={total} rows={labelled(byReferrer, referrerLabel)} />
          <BarListCard title="Browsers" total={total} rows={labelled(byBrowser)} />
          <BarListCard title="Operating systems" total={total} rows={labelled(byOs)} />
          <BarListCard title="Devices" total={total} rows={labelled(byDevice)} />
          <BarListCard
            title="Bot vs human" total={total}
            rows={total === 0 ? [] : [{ label: 'Humans', count: human }, { label: 'Bots', count: bots }]}
          />
        </div>

        <Panel
          title="Visit outcomes"
          description="Every visit in this period. Only redirected visits count toward the charts above and the click limit."
          bodyClassName="p-0"
        >
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
            {CLICK_OUTCOMES.map((o) => (
              <div key={o} className="grid gap-1 bg-card px-5 py-4">
                <dt className="text-sm text-muted-foreground">{OUTCOME_LABELS[o]}</dt>
                <dd className="text-xl font-semibold tracking-tight tabular-nums">{outcomes[o].toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <Panel
        title="Link settings"
        description="How this link behaves for visitors: its schedule, limits, and protection."
        actions={!readOnly && (
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}><Pencil /> Edit</Button>
        )}
      >
        <LinkSettings link={link} className="lg:grid-cols-3 lg:gap-8" />
      </Panel>

      <ClickLog key={code} code={code} initial={initial.log} countries={byCountry} />

      {!readOnly && (
        <LinkEditorSheet
          open={editorOpen}
          onOpenChange={setEditorOpen}
          link={link}
          onSaved={onSaved}
          onShowQr={(l) => setQrFor(l.code)}
          onDelete={onDelete}
        />
      )}
      <LinkQrDialog code={qrFor} onClose={() => setQrFor(null)} />
    </div>
  )
}

function percentHint(n: number, total: number) {
  return total === 0 ? 'No clicks yet' : `${percentLabel(n, total)} of clicks`
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  )
}

function Empty({ text, className }: { text: string; className?: string }) {
  return <div className={cn('flex h-[200px] items-center justify-center text-sm text-muted-foreground', className)}>{text}</div>
}

interface BarListRow {
  label: string
  count: number
}

/** Labelled horizontal bars; percentages are of `total`, so a top-N list needn't sum to 100%. */
function BarListCard({ title, rows, total }: { title: string; rows: BarListRow[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <Panel title={title} bodyClassName="p-3">
      {rows.length === 0 ? <Empty text="No data yet." className="h-[160px]" /> : (
        <ul className="grid gap-1">
          {rows.map((r) => (
            <li key={r.label} className="relative flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm">
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-chart-2/12 dark:bg-chart-2/20"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
              <span className="relative truncate" title={r.label}>{r.label}</span>
              <span className="relative shrink-0 font-medium tabular-nums">
                {r.count.toLocaleString('en-US')}
                <span className="ml-2 inline-block w-10 text-right font-normal text-muted-foreground">{percentLabel(r.count, total)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

type ClickLogPage = Awaited<ReturnType<typeof getClickLog>>

function ClickLog({ code, initial, countries }: { code: string; initial: ClickLogPage; countries: NamedCount[] }) {
  const [filter, setFilter] = useState<ClickLogFilter>({})
  const [clicks, setClicks] = useState(initial.clicks)
  const [cursor, setCursor] = useState(initial.nextCursor)
  const [loading, setLoading] = useState(false)

  async function load(next: ClickLogFilter, after?: ClickLogPage['nextCursor']) {
    setLoading(true)
    try {
      const page = await getClickLog({ data: { code, ...next, cursor: after ?? undefined } })
      setClicks((prev) => (after ? [...prev, ...page.clicks] : page.clicks))
      setCursor(page.nextCursor)
    } catch {
      toast.error("Couldn't load clicks")
    } finally {
      setLoading(false)
    }
  }

  function applyFilter(next: ClickLogFilter) {
    setFilter(next)
    void load(next)
  }

  const exportParams = new URLSearchParams()
  if (filter.humansOnly) exportParams.set('humansOnly', 'true')
  if (filter.country !== undefined) exportParams.set('country', filter.country)

  return (
    <Panel
      title="Click log"
      description="Every recorded visit, newest first. Privacy-enabled links, and guest accounts, omit raw IP, city, and user-agent values."
      bodyClassName="p-0"
      actions={
        <>
          <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm shadow-xs">
            <Checkbox
              checked={filter.humansOnly ?? false}
              onChange={(e) => applyFilter({ ...filter, humansOnly: e.target.checked || undefined })}
            />
            Humans only
          </label>
          <Select
            aria-label="Country"
            className="w-44"
            value={filter.country ?? '*'}
            onChange={(e) => applyFilter({ ...filter, country: e.target.value === '*' ? undefined : e.target.value })}
          >
            <option value="*">All countries</option>
            {countries.map((c) => (
              <option key={c.name ?? ''} value={c.name ?? ''}>{countryLabel(c.name)}</option>
            ))}
          </Select>
          <Button variant="outline" asChild>
            <a href={`/api/links/${encodeURIComponent(code)}/clicks?${exportParams}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        </>
      }
    >
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-5">Time</TableHead>
            <TableHead>IP</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Referrer</TableHead>
            <TableHead>Client</TableHead>
            <TableHead className="hidden lg:table-cell">User agent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clicks.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-14 text-center text-muted-foreground">
                {filter.humansOnly || filter.country !== undefined ? 'No clicks match these filters.' : 'No clicks yet.'}
              </TableCell>
            </TableRow>
          )}
          {clicks.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="whitespace-nowrap pl-5 text-muted-foreground">
                <LocalTime value={c.timestamp} />
                {c.outcome !== 'redirected' && (
                  <div className="mt-1"><Badge variant="outline" className="rounded-full font-medium">{OUTCOME_LABELS[c.outcome]}</Badge></div>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">{c.ip ?? '—'}</TableCell>
              <TableCell className="whitespace-nowrap">
                {[c.city, c.country && countryLabel(c.country)].filter(Boolean).join(', ') || '—'}
              </TableCell>
              <TableCell className="max-w-[140px] truncate">{referrerLabel(c.referrer)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-1.5 whitespace-nowrap">
                  {c.isBot ? <Bot className="h-3.5 w-3.5 text-orange-500" /> : <User className="h-3.5 w-3.5 text-emerald-500" />}
                  <span>{c.browser ?? 'Unknown'}</span>
                  {c.isBot && <Badge variant="secondary" className="rounded-full font-medium">bot</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{[c.os, c.deviceType].filter(Boolean).join(' · ')}</div>
              </TableCell>
              <TableCell className="hidden max-w-[220px] truncate text-xs text-muted-foreground lg:table-cell" title={c.userAgent ?? ''}>
                {c.userAgent ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cursor && (
        <div className="flex justify-center border-t p-3">
          <Button variant="outline" size="sm" disabled={loading} onClick={() => load(filter, cursor)}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </Panel>
  )
}
