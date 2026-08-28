import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, Bot, Copy, Download, ExternalLink, User, Lock } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { getClickLog, getLinkStats } from '~/lib/links'
import { CLICK_OUTCOMES, type ClickOutcome, type NamedCount } from '~/lib/click-stats'
import { countryLabel, percentLabel, referrerLabel } from '~/lib/click-labels'
import type { ClickLogFilter } from '~/lib/click-log'
import { Checkbox } from '~/components/ui/checkbox'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { NotFound, RouteError } from '~/components/route-status'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'
import { LocalTime } from '~/components/local-time'

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
  const initial = Route.useLoaderData()
  const { code } = Route.useParams()
  const [days, setDays] = useState(30)
  const [data, setData] = useState(initial.stats)
  const [loading, setLoading] = useState(false)

  const { link, series, byCountry, byReferrer, byBrowser, byOs, byDevice, human, bots, uniqueVisitors, outcomes } = data
  const total = human + bots

  async function changeRange(d: number) {
    setDays(d)
    setLoading(true)
    setData(await getLinkStats({ data: { code, days: d } }))
    setLoading(false)
  }

  const labelled = (rows: NamedCount[], label = (name: string | null) => name ?? 'Unknown') =>
    rows.map((r) => ({ label: label(r.name), count: r.count }))

  return (
    <div className={`grid gap-6 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/dashboard"><ArrowLeft /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">/{link.code}</h1>
            {link.passwordProtected && <Lock className="h-4 w-4 text-muted-foreground" />}
            {link.privacyEnabled && <Badge variant="secondary">privacy</Badge>}
            <Button
              variant="ghost" size="icon" title="Copy short URL"
              onClick={async () => {
                await navigator.clipboard.writeText(`${window.location.origin}/${link.code}`)
                toast.success('Copied')
              }}
            >
              <Copy />
            </Button>
          </div>
          <a href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            {link.url} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <Button key={r.days} variant={days === r.days ? 'default' : 'outline'} size="sm" onClick={() => changeRange(r.days)}>
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Stat label="Total clicks" value={link.clickCount} />
        <Stat label={`Clicks (${days}d)`} value={total} />
        <Stat label="Humans" value={human} />
        <Stat label="Unique humans" value={uniqueVisitors} />
        <Stat label="Bots" value={bots} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clicks over time</CardTitle>
        </CardHeader>
        <CardContent>
          {series.every((p) => p.count === 0) ? (
            <Empty text="No clicks in this period." />
          ) : (
            <ChartContainer config={seriesConfig} className="h-[260px] w-full">
              <AreaChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8}
                  tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="count" stroke="var(--color-count)" fill="var(--color-count)" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="unique" stroke="var(--color-unique)" fill="var(--color-unique)" fillOpacity={0.08} strokeWidth={2} />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
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

      <Card>
        <CardHeader>
          <CardTitle>Visit outcomes</CardTitle>
          <CardDescription>
            Every visit in this period. Only redirected visits count toward the charts above and the click limit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {CLICK_OUTCOMES.map((o) => (
              <div key={o}>
                <dt className="text-sm text-muted-foreground">{OUTCOME_LABELS[o]}</dt>
                <dd className="text-xl font-semibold tabular-nums">{outcomes[o].toLocaleString('en-US')}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <ClickLog code={code} initial={initial.log} countries={byCountry} />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="text-2xl font-bold tabular-nums">{value.toLocaleString('en-US')}</div>
      </CardContent>
    </Card>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{text}</div>
}

interface BarListRow {
  label: string
  count: number
}

/** Labelled horizontal bars; percentages are of `total`, so a top-N list needn't sum to 100%. */
function BarListCard({ title, rows, total }: { title: string; rows: BarListRow[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.count), 1)
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty text="No data." /> : (
          <ul className="grid gap-1.5">
            {rows.map((r) => (
              <li key={r.label} className="relative flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm">
                <div
                  className="absolute inset-y-0 left-0 rounded-md bg-chart-1/15"
                  style={{ width: `${(r.count / max) * 100}%` }}
                />
                <span className="relative truncate" title={r.label}>{r.label}</span>
                <span className="relative shrink-0 tabular-nums">
                  {r.count.toLocaleString('en-US')}
                  <span className="ml-2 inline-block w-10 text-right text-muted-foreground">{percentLabel(r.count, total)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="grid gap-1.5">
          <CardTitle>Click log</CardTitle>
          <CardDescription>
            Every recorded visit, newest first. Privacy-enabled links omit raw IP, city, and user-agent values.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={filter.humansOnly ?? false}
              onChange={(e) => applyFilter({ ...filter, humansOnly: e.target.checked || undefined })}
            />
            Humans only
          </label>
          <select
            aria-label="Country"
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={filter.country ?? '*'}
            onChange={(e) => applyFilter({ ...filter, country: e.target.value === '*' ? undefined : e.target.value })}
          >
            <option value="*">All countries</option>
            {countries.map((c) => (
              <option key={c.name ?? ''} value={c.name ?? ''}>{countryLabel(c.name)}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/links/${encodeURIComponent(code)}/clicks?${exportParams}`} download>
              <Download /> Export CSV
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 pb-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
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
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  {filter.humansOnly || filter.country !== undefined ? 'No clicks match these filters.' : 'No clicks yet.'}
                </TableCell>
              </TableRow>
            )}
            {clicks.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <LocalTime value={c.timestamp} />
                  {c.outcome !== 'redirected' && (
                    <div><Badge variant="outline">{OUTCOME_LABELS[c.outcome]}</Badge></div>
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
                    {c.isBot && <Badge variant="secondary">bot</Badge>}
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
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" disabled={loading} onClick={() => load(filter, cursor)}>
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
