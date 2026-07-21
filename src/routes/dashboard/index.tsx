import { Link, createFileRoute, useRouter, useRouteContext } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Copy, Download, Lock,
  Pencil, Plus, QrCode, Search, TimerOff, Trash2, X,
} from 'lucide-react'
import {
  bulkDeleteLinks, bulkExpireLinks, deleteLink, getOverview, listLinks,
} from '~/lib/links'
import { listUserDirectory } from '~/lib/users'
import type { Link as LinkRow } from '~/lib/schema'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Badge } from '~/components/ui/badge'
import { Checkbox } from '~/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { LinkFormDialog } from '~/components/link-form'

export const Route = createFileRoute('/dashboard/')({
  loader: async () => {
    const [links, overview, users] = await Promise.all([listLinks(), getOverview(), listUserDirectory()])
    return { links, overview, users }
  },
  component: LinksPage,
})

function shortUrl(code: string) {
  return `${window.location.origin}/${code}`
}

type SortKey = 'code' | 'url' | 'clickCount' | 'createdAt' | 'expiresAt'
type StatusFilter = 'all' | 'active' | 'expired' | 'protected' | 'unused'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'protected', label: 'Password-protected' },
  { value: 'unused', label: 'No clicks' },
]

const isExpired = (l: LinkRow) => Boolean(l.expiresAt && new Date(l.expiresAt) < new Date())

const UNTAGGED = '__untagged__'

function LinksPage() {
  const router = useRouter()
  const { user } = useRouteContext({ from: '/dashboard' })
  const isAdmin = user?.role === 'admin'
  const { links, overview, users } = Route.useLoaderData()
  const ownerById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LinkRow | null>(null)
  const [qrFor, setQrFor] = useState<string | null>(null)

  const allTags = useMemo(
    () => [...new Set(links.flatMap((l) => l.tags))].sort(),
    [links],
  )

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    let rows = links.filter((l) => {
      if (q) {
        const owner = l.userId ? ownerById.get(l.userId) : null
        const haystack = [
          l.code,
          l.url,
          l.title ?? '',
          ...l.tags,
          ...(owner ? [owner.email, owner.name] : []),
        ]
          .join('\n')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
    if (activeTags.size > 0) {
      rows = rows.filter((l) =>
        [...activeTags].some((t) => (t === UNTAGGED ? l.tags.length === 0 : l.tags.includes(t))),
      )
    }
    switch (status) {
      case 'active':
        rows = rows.filter((l) => !isExpired(l))
        break
      case 'expired':
        rows = rows.filter((l) => isExpired(l))
        break
      case 'protected':
        rows = rows.filter((l) => Boolean(l.passwordHash))
        break
      case 'unused':
        rows = rows.filter((l) => l.clickCount === 0)
        break
    }
    const dir = sortAsc ? 1 : -1
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1 // nulls last regardless of direction
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
    return rows
  }, [links, query, status, activeTags, sortKey, sortAsc, ownerById])

  function toggleTag(tag: string) {
    const next = new Set(activeTags)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    setActiveTags(next)
  }

  const refresh = () => {
    setSelected(new Set())
    router.invalidate()
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id))

  function toggleAll() {
    if (allVisibleSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map((l) => l.id)))
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(key === 'code' || key === 'url')
    }
  }

  async function copy(code: string) {
    await navigator.clipboard.writeText(shortUrl(code))
    toast.success('Copied to clipboard')
  }

  async function onDelete(link: LinkRow) {
    if (!confirm(`Delete /${link.code}? This also deletes its analytics.`)) return
    await deleteLink({ data: { id: link.id } })
    toast.success('Link deleted')
    refresh()
  }

  async function onBulkDelete() {
    if (!confirm(`Delete ${selected.size} link${selected.size > 1 ? 's' : ''}? This also deletes their analytics.`)) return
    const { count } = await bulkDeleteLinks({ data: { ids: [...selected] } })
    toast.success(`${count} link${count > 1 ? 's' : ''} deleted`)
    refresh()
  }

  async function onBulkExpire() {
    const { count } = await bulkExpireLinks({ data: { ids: [...selected] } })
    toast.success(`${count} link${count > 1 ? 's' : ''} expired`)
    refresh()
  }

  function onBulkExport() {
    const rows = links.filter((l) => selected.has(l.id))
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      'code,short_url,destination,title,tags,clicks,created_at,expires_at,password_protected',
      ...rows.map((l) =>
        [
          esc(l.code),
          esc(shortUrl(l.code)),
          esc(l.url),
          esc(l.title),
          esc(l.tags.join(' ')),
          l.clickCount,
          esc(l.createdAt ? new Date(l.createdAt).toISOString() : null),
          esc(l.expiresAt ? new Date(l.expiresAt).toISOString() : null),
          l.passwordHash ? 'yes' : 'no',
        ].join(','),
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `linkify-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success(`Exported ${rows.length} link${rows.length > 1 ? 's' : ''}`)
  }

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total links" value={overview.linkCount} />
        <StatCard label="Clicks (30d)" value={overview.clicks30d} />
        <StatCard label="Humans (30d)" value={overview.clicks30d - overview.bots30d} />
        <StatCard label="Bots (30d)" value={overview.bots30d} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search links…"
            className="pl-8"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((o) => (
            <Button
              key={o.value}
              variant={status === o.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatus(o.value)}
            >
              {o.label}
            </Button>
          ))}
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
          <Plus /> New link
        </Button>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Tags:</span>
          {allTags.map((t) => (
            <Button
              key={t}
              variant={activeTags.has(t) ? 'default' : 'outline'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => toggleTag(t)}
            >
              {t}
            </Button>
          ))}
          <Button
            variant={activeTags.has(UNTAGGED) ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => toggleTag(UNTAGGED)}
          >
            Untagged
          </Button>
          {activeTags.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setActiveTags(new Set())}
            >
              <X /> Clear
            </Button>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onBulkExport}>
            <Download /> Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={onBulkExpire}>
            <TimerOff /> Expire now
          </Button>
          <Button variant="destructive" size="sm" onClick={onBulkDelete}>
            <Trash2 /> Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            <X /> Clear
          </Button>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <SortableHead label="Short link" sortKeyName="code" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} />
              <SortableHead label="Destination" sortKeyName="url" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} className="hidden md:table-cell" />
              <SortableHead label="Clicks" sortKeyName="clickCount" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} className="text-right" />
              <SortableHead label="Created" sortKeyName="createdAt" currentKey={sortKey} asc={sortAsc} onSort={toggleSort} className="hidden sm:table-cell" />
              {isAdmin && <TableHead className="hidden lg:table-cell">Owner</TableHead>}
              <TableHead className="w-[160px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 7 : 6} className="py-10 text-center text-muted-foreground">
                  {links.length === 0 ? 'No links yet — create your first one.' : 'No matches.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((link) => (
              <TableRow key={link.id} data-state={selected.has(link.id) ? 'selected' : undefined}>
                <TableCell>
                  <Checkbox
                    checked={selected.has(link.id)}
                    onChange={() => toggleOne(link.id)}
                    aria-label={`Select /${link.code}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copy(link.code)}
                      className="font-mono font-medium text-primary hover:underline cursor-pointer"
                      title="Copy short URL"
                    >
                      /{link.code}
                    </button>
                    {link.passwordHash && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                    {isExpired(link) && <Badge variant="destructive">expired</Badge>}
                    {!isExpired(link) && link.expiresAt && (
                      <Badge variant="secondary" title={new Date(link.expiresAt).toLocaleString()}>
                        expires {new Date(link.expiresAt).toLocaleDateString()}
                      </Badge>
                    )}
                  </div>
                  {link.title && <div className="text-xs text-muted-foreground">{link.title}</div>}
                  {link.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {link.tags.map((t) => (
                        <button key={t} onClick={() => toggleTag(t)} title={`Filter by ${t}`}>
                          <Badge
                            variant={activeTags.has(t) ? 'default' : 'secondary'}
                            className="cursor-pointer text-[10px]"
                          >
                            {t}
                          </Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-[300px] truncate md:table-cell">
                  <a href={link.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:underline">
                    {link.url}
                  </a>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{link.clickCount}</TableCell>
                <TableCell className="hidden text-muted-foreground sm:table-cell">
                  {new Date(link.createdAt).toLocaleDateString()}
                </TableCell>
                {isAdmin && (
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {link.userId ? (ownerById.get(link.userId)?.email ?? '—') : '—'}
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" title="Analytics" asChild>
                      <Link to="/dashboard/links/$code" params={{ code: link.code }}>
                        <BarChart3 />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon" title="QR code" onClick={() => setQrFor(link.code)}>
                      <QrCode />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => { setEditing(link); setFormOpen(true) }}>
                      <Pencil />
                    </Button>
                    <Button variant="ghost" size="icon" title="Delete" onClick={() => onDelete(link)}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <LinkFormDialog open={formOpen} onOpenChange={setFormOpen} link={editing} onSaved={refresh} />

      <Dialog open={Boolean(qrFor)} onOpenChange={() => setQrFor(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-mono">/{qrFor}</DialogTitle>
          </DialogHeader>
          {qrFor && (
            <div className="grid justify-items-center gap-4">
              <img src={`/api/qr/${qrFor}`} alt={`QR code for /${qrFor}`} className="rounded-lg border" width={256} height={256} />
              <Button variant="outline" asChild>
                <a href={`/api/qr/${qrFor}`} download={`${qrFor}.png`}>Download PNG</a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SortableHead({
  label, sortKeyName, currentKey, asc, onSort, className = '',
}: {
  label: string
  sortKeyName: SortKey
  currentKey: SortKey
  asc: boolean
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = currentKey === sortKeyName
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(sortKeyName)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${className.includes('text-right') ? 'flex-row-reverse' : ''} ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active ? (
          asc ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </TableHead>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
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
