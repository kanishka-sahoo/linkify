import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { ArrowLeft, Bot, Copy, ExternalLink, User, Lock } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { getLinkStats } from '~/lib/links'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '~/components/ui/chart'

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
]

export const Route = createFileRoute('/dashboard/links/$code')({
  loader: ({ params }) => getLinkStats({ data: { code: params.code, days: 30 } }),
  component: AnalyticsPage,
})

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

const seriesConfig = { count: { label: 'Clicks', color: 'var(--chart-2)' } } satisfies ChartConfig

function AnalyticsPage() {
  const initial = Route.useLoaderData()
  const { code } = Route.useParams()
  const [days, setDays] = useState(30)
  const [data, setData] = useState(initial)
  const [loading, setLoading] = useState(false)

  const { link, series, byCountry, byReferrer, byBrowser, byOs, byDevice, human, bots, recent } = data
  const total = human + bots

  async function changeRange(d: number) {
    setDays(d)
    setLoading(true)
    setData(await getLinkStats({ data: { code, days: d } }))
    setLoading(false)
  }

  const named = (rows: { name: string | null; count: number }[]) =>
    rows.map((r) => ({ ...r, name: r.name ?? 'Unknown' }))

  return (
    <div className={`grid gap-6 ${loading ? 'opacity-60 transition-opacity' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/dashboard"><ArrowLeft /></Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">/{link.code}</h1>
            {link.passwordHash && <Lock className="h-4 w-4 text-muted-foreground" />}
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total clicks" value={link.clickCount} />
        <Stat label={`Clicks (${days}d)`} value={total} />
        <Stat label="Humans" value={human} />
        <Stat label="Bots" value={bots} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Clicks over time</CardTitle>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
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
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <BreakdownCard title="Countries" rows={named(byCountry)} />
        <BreakdownCard title="Referrers" rows={named(byReferrer)} />
        <PieCard title="Browsers" rows={named(byBrowser)} />
        <PieCard title="Operating systems" rows={named(byOs)} />
        <PieCard title="Devices" rows={named(byDevice)} />
        <Card>
          <CardHeader>
            <CardTitle>Bot vs human</CardTitle>
          </CardHeader>
          <CardContent>
            {total === 0 ? <Empty text="No data." /> : (
              <ChartContainer config={{}} className="h-[200px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Pie
                    data={[
                      { name: 'Humans', value: human, fill: 'var(--chart-2)' },
                      { name: 'Bots', value: bots, fill: 'var(--chart-5)' },
                    ]}
                    dataKey="value" nameKey="name" innerRadius={50} strokeWidth={2}
                  />
                </PieChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent clicks</CardTitle>
          <CardDescription>Last {recent.length} recorded visits with raw metadata.</CardDescription>
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
              {recent.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No clicks yet.</TableCell>
                </TableRow>
              )}
              {recent.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(c.timestamp).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.ip ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="max-w-[140px] truncate">{c.referrer ?? 'direct'}</TableCell>
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
        </CardContent>
      </Card>
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
        <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">{text}</div>
}

function BreakdownCard({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty text="No data." /> : (
          <ChartContainer config={{ count: { label: 'Clicks', color: 'var(--chart-1)' } }} className="h-[200px] w-full">
            <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={90} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function PieCard({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? <Empty text="No data." /> : (
          <ChartContainer config={{}} className="h-[200px] w-full">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie data={rows} dataKey="count" nameKey="name" innerRadius={50} strokeWidth={2}>
                {rows.map((r, i) => (
                  <Cell key={r.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
