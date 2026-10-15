import { Link, createFileRoute, useRouter, useRouteContext } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Check, Copy, CopyPlus, Download, EyeOff, Info, Link2, Lock,
  MoreHorizontal, Pencil, Plus, QrCode, Search, SearchX, SlidersHorizontal, TimerOff, Trash2, Upload, X,
} from 'lucide-react'
import {
  bulkDeleteLinks, bulkExpireLinks, deleteLink, getOverview, listLinks,
} from '~/lib/links'
import { listUserDirectory } from '~/lib/users'
import type { SafeLink as LinkRow } from '~/lib/links'
import { csvCell } from '~/lib/csv'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Checkbox } from '~/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { LinkFormDialog } from '~/components/link-form'
import { LinkImportDialog } from '~/components/link-import-dialog'
import { BulkEditLinksDialog } from '~/components/bulk-edit-links-dialog'
import { LinkDetailsSheet, type LinkOwner } from '~/components/link-details'
import { ClickUsage, StateNote, StatusBadge, displayUrl, linkState, type LinkState } from '~/components/link-status'
import { LocalTime } from '~/components/local-time'

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
type StatusFilter = 'all' | LinkState | 'protected' | 'unused'

const STATUS_FILTERS: { value: StatusFilter; label: string; matches: (link: LinkRow) => boolean }[] = [
  { value: 'all', label: 'All', matches: () => true },
  { value: 'active', label: 'Active', matches: (l) => linkState(l) === 'active' },
  { value: 'scheduled', label: 'Scheduled', matches: (l) => linkState(l) === 'scheduled' },
  { value: 'paused', label: 'Paused', matches: (l) => linkState(l) === 'paused' },
  { value: 'expired', label: 'Expired', matches: (l) => linkState(l) === 'expired' },
  { value: 'limit-reached', label: 'Limit reached', matches: (l) => linkState(l) === 'limit-reached' },
  { value: 'protected', label: 'Password', matches: (l) => l.passwordProtected },
  { value: 'unused', label: 'No clicks', matches: (l) => l.clickCount === 0 },
]

const SORT_OPTIONS: { value: SortKey; label: string; asc: boolean }[] = [
  { value: 'createdAt', label: 'Newest', asc: false },
  { value: 'clickCount', label: 'Most clicks', asc: false },
  { value: 'code', label: 'Short link (A–Z)', asc: true },
  { value: 'url', label: 'Destination (A–Z)', asc: true },
  { value: 'expiresAt', label: 'Expiring soonest', asc: true },
]

const UNTAGGED = '__untagged__'

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

/** What a row can do; `undefined` handlers are hidden from read-only viewers. */
interface RowActions {
  details: (link: LinkRow) => void
  qr: (link: LinkRow) => void
  copy: (link: LinkRow) => void
  filterByTag: (tag: string) => void
  edit?: (link: LinkRow) => void
  duplicate?: (link: LinkRow) => void
  remove?: (link: LinkRow) => void
}

function LinksPage() {
  const router = useRouter()
  const { user } = useRouteContext({ from: '/dashboard' })
  const isAdmin = user?.role === 'admin'
  const readOnly = user?.role === 'guest'
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
  const [duplicating, setDuplicating] = useState(false)
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [detailsId, setDetailsId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)

  const allTags = useMemo(
    () => [...new Set(links.flatMap((l) => l.tags))].sort(),
    [links],
  )

  const ownerOf = (link: LinkRow): LinkOwner | undefined => (link.userId ? ownerById.get(link.userId) : undefined)

  // Search and tags narrow the set the status tabs count over; the status tab then narrows it further.
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase()
    return links.filter((l) => {
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
      if (activeTags.size > 0) {
        return [...activeTags].some((t) => (t === UNTAGGED ? l.tags.length === 0 : l.tags.includes(t)))
      }
      return true
    })
  }, [links, query, activeTags, ownerById])

  const statusCounts = useMemo(
    () => Object.fromEntries(STATUS_FILTERS.map((f) => [f.value, matching.filter(f.matches).length])) as Record<StatusFilter, number>,
    [matching],
  )

  const filtered = useMemo(() => {
    const matches = STATUS_FILTERS.find((f) => f.value === status)!.matches
    const dir = sortAsc ? 1 : -1
    return matching.filter(matches).sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1 // nulls last regardless of direction
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [matching, status, sortKey, sortAsc])

  const filtersActive = query !== '' || status !== 'all' || activeTags.size > 0
  const activeCount = links.filter((l) => linkState(l) === 'active').length
  const detailsLink = detailsId ? links.find((l) => l.id === detailsId) ?? null : null

  function clearFilters() {
    setQuery('')
    setStatus('all')
    setActiveTags(new Set())
  }

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
      setSortAsc(SORT_OPTIONS.find((o) => o.value === key)!.asc)
    }
  }

  function openForm(link: LinkRow | null, duplicate = false) {
    setDetailsId(null)
    setEditing(link)
    setDuplicating(duplicate)
    setFormOpen(true)
  }

  async function onDelete(link: LinkRow) {
    if (!confirm(`Delete /${link.code}? This also deletes its analytics.`)) return
    await deleteLink({ data: { id: link.id } })
    toast.success('Link deleted')
    refresh()
  }

  const actions: RowActions = {
    details: (link) => setDetailsId(link.id),
    qr: (link) => setQrFor(link.code),
    copy: async (link) => {
      await navigator.clipboard.writeText(shortUrl(link.code))
      toast.success('Short link copied', { description: shortUrl(link.code) })
    },
    filterByTag: toggleTag,
    ...(!readOnly && {
      edit: (link: LinkRow) => openForm(link),
      duplicate: (link: LinkRow) => openForm(link, true),
      remove: onDelete,
    }),
  }

  async function onBulkDelete() {
    if (!confirm(`Delete ${plural(selected.size, 'link')}? This also deletes their analytics.`)) return
    const { count } = await bulkDeleteLinks({ data: { ids: [...selected] } })
    toast.success(`${plural(count, 'link')} deleted`)
    refresh()
  }

  async function onBulkExpire() {
    const { count } = await bulkExpireLinks({ data: { ids: [...selected] } })
    toast.success(`${plural(count, 'link')} expired`)
    refresh()
  }

  function onBulkExport() {
    const rows = links.filter((l) => selected.has(l.id))
    const csv = [
      'code,short_url,destination,title,tags,status,starts_at,expires_at,expired_redirect_url,max_clicks,privacy_enabled,clicks,created_at,password_protected',
      ...rows.map((l) =>
        [
          csvCell(l.code),
          csvCell(shortUrl(l.code)),
          csvCell(l.url),
          csvCell(l.title),
          csvCell(l.tags.join(' ')),
          csvCell(l.status),
          csvCell(l.startsAt ? new Date(l.startsAt).toISOString() : null),
          csvCell(l.expiresAt ? new Date(l.expiresAt).toISOString() : null),
          csvCell(l.expiredRedirectUrl),
          csvCell(l.maxClicks),
          l.privacyEnabled ? 'yes' : 'no',
          l.clickCount,
          csvCell(l.createdAt ? new Date(l.createdAt).toISOString() : null),
          l.passwordProtected ? 'yes' : 'no',
        ].join(','),
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `linkify-export-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast.success(`Exported ${plural(rows.length, 'link')}`)
  }

  const humans30d = overview.clicks30d - overview.bots30d
  const shareOfClicks = (n: number) =>
    overview.clicks30d === 0 ? 'Last 30 days' : `${Math.round((n / overview.clicks30d) * 100)}% of clicks`

  return (
    <div className={cn('grid grid-cols-1 gap-6', selected.size > 0 && 'pb-24')}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Links</h1>
          <p className="text-sm text-muted-foreground">
            {readOnly
              ? 'A read-only view of the links shared with you. Open any link to see how it’s configured.'
              : 'Create, share, and track your short links.'}
          </p>
        </div>
        {!readOnly && (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 bg-background sm:flex-none" onClick={() => setImportOpen(true)}>
              <Upload /> Import
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => openForm(null)}>
              <Plus /> New link
            </Button>
          </div>
        )}
      </header>

      <section aria-label="Overview" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm sm:grid-cols-5">
        <Stat className="col-span-2 sm:col-span-1" label="Links" value={overview.linkCount} hint={`${activeCount.toLocaleString('en-US')} active`} />
        <Stat label="Clicks" value={overview.clicks30d} hint="Last 30 days" />
        <Stat label="Unique humans" value={overview.unique30d} hint="Last 30 days" />
        <Stat label="Humans" value={humans30d} hint={shareOfClicks(humans30d)} />
        <Stat label="Bots" value={overview.bots30d} hint={shareOfClicks(overview.bots30d)} />
      </section>

      <section aria-label="Links" className="grid grid-cols-1 gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex gap-2 lg:w-80 lg:shrink-0">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search links…"
                aria-label="Search links"
                className="bg-background pl-9"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              aria-label="Sort links"
              className="h-9 rounded-md border bg-background px-2 text-sm md:hidden"
              value={sortKey}
              onChange={(e) => toggleSort(e.target.value as SortKey)}
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <StatusTabs value={status} counts={statusCounts} onChange={setStatus} />
        </div>

        {allTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Tags</span>
            {[...allTags, UNTAGGED].map((t) => (
              <TagChip key={t} active={activeTags.has(t)} onClick={() => toggleTag(t)}>
                {t === UNTAGGED ? 'Untagged' : t}
              </TagChip>
            ))}
          </div>
        )}

        <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
          <label className="flex items-center gap-2 md:hidden">
            <Checkbox checked={allVisibleSelected} onChange={toggleAll} disabled={filtered.length === 0} />
            Select all
          </label>
          <span className="tabular-nums" aria-live="polite">
            {filtered.length === links.length
              ? plural(links.length, 'link')
              : `${filtered.length.toLocaleString('en-US')} of ${plural(links.length, 'link')}`}
          </span>
          {filtersActive && (
            <Button variant="ghost" size="sm" className="ml-auto h-7 text-muted-foreground" onClick={clearFilters}>
              <X /> Clear filters
            </Button>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
          {filtered.length === 0 ? (
            <EmptyState
              filtered={links.length > 0}
              readOnly={readOnly}
              onClear={clearFilters}
              onCreate={() => openForm(null)}
            />
          ) : (
            <>
              <LinksTable
                links={filtered}
                selected={selected}
                allSelected={allVisibleSelected}
                onToggleAll={toggleAll}
                onToggle={toggleOne}
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={toggleSort}
                ownerOf={isAdmin ? ownerOf : undefined}
                actions={actions}
              />
              <ul className="divide-y md:hidden">
                {filtered.map((link) => (
                  <LinkCard
                    key={link.id}
                    link={link}
                    selected={selected.has(link.id)}
                    onToggle={() => toggleOne(link.id)}
                    actions={actions}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          readOnly={readOnly}
          onExport={onBulkExport}
          onExpire={onBulkExpire}
          onEdit={() => setBulkEditOpen(true)}
          onDelete={onBulkDelete}
          onClear={() => setSelected(new Set())}
        />
      )}

      <LinkDetailsSheet
        link={detailsLink}
        ownerOf={ownerOf}
        onClose={() => setDetailsId(null)}
        onShowQr={actions.qr}
        onEdit={actions.edit}
      />
      <LinkFormDialog open={formOpen} onOpenChange={setFormOpen} link={editing} duplicate={duplicating} onSaved={refresh} />
      <LinkImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={refresh} />
      <BulkEditLinksDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        ids={[...selected]}
        users={users}
        isAdmin={isAdmin}
        onSaved={refresh}
      />
      <QrDialog code={qrFor} onClose={() => setQrFor(null)} />
    </div>
  )
}

function Stat({ label, value, hint, className }: { label: string; value: number; hint: string; className?: string }) {
  return (
    <div className={cn('grid gap-1 bg-card p-4 sm:p-5', className)}>
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">{value.toLocaleString('en-US')}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

/** Segmented status filter with live counts; scrolls sideways on narrow screens. */
function StatusTabs({ value, counts, onChange }: {
  value: StatusFilter
  counts: Record<StatusFilter, number>
  onChange: (value: StatusFilter) => void
}) {
  return (
    <div className="scrollbar-none -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="group" aria-label="Filter by status" className="inline-flex gap-0.5 rounded-lg border bg-muted/60 p-0.5">
        {STATUS_FILTERS.map((f) => {
          const active = value === f.value
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(f.value)}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
              <span className={cn('text-xs tabular-nums', active ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                {counts[f.value]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TagChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={active ? 'Remove tag filter' : 'Filter by this tag'}
      className={cn(
        'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground',
      )}
    >
      {active && <Check className="size-3" />}
      {children}
    </button>
  )
}

function LinksTable({
  links, selected, allSelected, onToggleAll, onToggle, sortKey, sortAsc, onSort, ownerOf, actions,
}: {
  links: LinkRow[]
  selected: Set<string>
  allSelected: boolean
  onToggleAll: () => void
  onToggle: (id: string) => void
  sortKey: SortKey
  sortAsc: boolean
  onSort: (key: SortKey) => void
  /** Only admins see an owner column. */
  ownerOf?: (link: LinkRow) => LinkOwner | undefined
  actions: RowActions
}) {
  const sortProps = { currentKey: sortKey, asc: sortAsc, onSort }
  return (
    <div className="hidden md:block">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pl-4">
              <Checkbox checked={allSelected} onChange={onToggleAll} aria-label="Select all" />
            </TableHead>
            <SortableHead label="Link" sortKeyName="code" {...sortProps} />
            <TableHead>Status</TableHead>
            <SortableHead label="Clicks" sortKeyName="clickCount" className="text-right" {...sortProps} />
            <SortableHead label="Created" sortKeyName="createdAt" className="hidden lg:table-cell" {...sortProps} />
            {ownerOf && <TableHead className="hidden xl:table-cell">Owner</TableHead>}
            <TableHead className="w-24 pr-4"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => {
            const state = linkState(link)
            const owner = ownerOf?.(link)
            return (
              <TableRow key={link.id} data-state={selected.has(link.id) ? 'selected' : undefined} className="group">
                <TableCell className="pl-4">
                  <Checkbox
                    checked={selected.has(link.id)}
                    onChange={() => onToggle(link.id)}
                    aria-label={`Select /${link.code}`}
                  />
                </TableCell>
                {/* w-full + max-w-0 lets the identity column absorb spare width and truncate long URLs. */}
                <TableCell className="w-full max-w-0 py-3">
                  <LinkIdentity link={link} actions={actions} />
                </TableCell>
                <TableCell>
                  <div className="grid justify-items-start gap-1">
                    <StatusBadge state={state} />
                    <StateNote link={link} state={state} />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <ClickUsage count={link.clickCount} max={link.maxClicks} className="ml-auto text-right" />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  <LocalTime value={link.createdAt} dateOnly />
                </TableCell>
                {ownerOf && (
                  <TableCell className="hidden max-w-48 xl:table-cell">
                    <div className="truncate" title={owner?.email}>{owner?.name ?? '—'}</div>
                    {owner && (
                      <div className="truncate text-xs text-muted-foreground">
                        {owner.deactivatedAt ? 'Deactivated' : owner.email}
                      </div>
                    )}
                  </TableCell>
                )}
                <TableCell className="pr-4">
                  <div className="flex justify-end gap-0.5">
                    <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" title="Analytics" asChild>
                      <Link to="/dashboard/links/$code" params={{ code: link.code }} aria-label={`Analytics for /${link.code}`}>
                        <BarChart3 />
                      </Link>
                    </Button>
                    <RowMenu link={link} actions={actions} />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** Short link, title, destination, flags, and tags — the parts that identify a link at a glance. */
function LinkIdentity({ link, actions }: { link: LinkRow; actions: RowActions }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={() => actions.details(link)}
          className="cursor-pointer truncate rounded-sm font-mono text-sm font-semibold hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="View link details"
        >
          /{link.code}
        </button>
        {link.passwordProtected && (
          <span title="Password protected" className="shrink-0 text-muted-foreground">
            <Lock className="size-3.5" /><span className="sr-only">Password protected</span>
          </span>
        )}
        {link.privacyEnabled && (
          <span title="Privacy mode: visitor details aren't stored" className="shrink-0 text-muted-foreground">
            <EyeOff className="size-3.5" /><span className="sr-only">Privacy mode</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => actions.copy(link)}
          className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted-foreground transition hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
          title="Copy short link"
          aria-label={`Copy short link /${link.code}`}
        >
          <Copy className="size-3.5" />
        </button>
        {link.title && <span className="hidden truncate text-sm text-muted-foreground lg:inline">{link.title}</span>}
      </div>
      {link.title && <div className="truncate text-sm text-muted-foreground lg:hidden">{link.title}</div>}
      <a
        href={link.url}
        target="_blank"
        rel="noreferrer"
        title={link.url}
        className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        <span aria-hidden className="shrink-0 text-muted-foreground/60">↳</span>
        <span className="truncate">{displayUrl(link.url)}</span>
      </a>
      {link.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {link.tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => actions.filterByTag(t)}
              title={`Filter by ${t}`}
              className="cursor-pointer rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function LinkCard({ link, selected, onToggle, actions }: {
  link: LinkRow
  selected: boolean
  onToggle: () => void
  actions: RowActions
}) {
  const state = linkState(link)
  return (
    <li className={cn('group flex gap-3 p-4 transition-colors', selected && 'bg-muted/60')}>
      <Checkbox className="mt-1" checked={selected} onChange={onToggle} aria-label={`Select /${link.code}`} />
      <div className="grid min-w-0 flex-1 gap-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <LinkIdentity link={link} actions={actions} />
          </div>
          <RowMenu link={link} actions={actions} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <StatusBadge state={state} />
          <StateNote link={link} state={state} />
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
            {link.maxClicks ? <ClickUsage count={link.clickCount} max={link.maxClicks} /> : (
              <><BarChart3 className="size-3.5" /><ClickUsage count={link.clickCount} max={null} className="text-foreground" /> clicks</>
            )}
          </span>
        </div>
      </div>
    </li>
  )
}

function RowMenu({ link, actions }: { link: LinkRow; actions: RowActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-muted-foreground" aria-label={`Actions for /${link.code}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => actions.details(link)}><Info /> View details</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/links/$code" params={{ code: link.code }}><BarChart3 /> Analytics</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.copy(link)}><Copy /> Copy short link</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.qr(link)}><QrCode /> QR code</DropdownMenuItem>
        {actions.edit && actions.duplicate && actions.remove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.edit!(link)}><Pencil /> Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.duplicate!(link)}><CopyPlus /> Duplicate</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => actions.remove!(link)}><Trash2 /> Delete</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const Icon = !active ? ArrowUpDown : asc ? ArrowUp : ArrowDown
  return (
    <TableHead className={className} aria-sort={active ? (asc ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKeyName)}
        className={cn(
          'group/sort inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          className.includes('text-right') && 'flex-row-reverse',
          active && 'text-foreground',
        )}
      >
        {label}
        <Icon className={cn('size-3.5', !active && 'opacity-0 transition-opacity group-hover/sort:opacity-60')} />
      </button>
    </TableHead>
  )
}

function EmptyState({ filtered, readOnly, onClear, onCreate }: {
  filtered: boolean
  readOnly: boolean
  onClear: () => void
  onCreate: () => void
}) {
  const Icon = filtered ? SearchX : Link2
  return (
    <div className="grid justify-items-center gap-3 px-6 py-16 text-center">
      <span className="grid size-11 place-items-center rounded-xl border bg-muted/50 text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="grid gap-1">
        <h2 className="font-medium">
          {filtered ? 'No links match your filters' : readOnly ? 'Nothing shared yet' : 'Create your first short link'}
        </h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {filtered
            ? 'Try a different search, status, or tag.'
            : readOnly
              ? 'No links have been shared with this account.'
              : 'Shorten a URL, then track every click from this dashboard.'}
        </p>
      </div>
      {filtered ? (
        <Button variant="outline" size="sm" onClick={onClear}>Clear filters</Button>
      ) : !readOnly && (
        <Button size="sm" onClick={onCreate}><Plus /> New link</Button>
      )}
    </div>
  )
}

/** Floating action bar for the current selection. */
function BulkBar({ count, readOnly, onExport, onExpire, onEdit, onDelete, onClear }: {
  count: number
  readOnly: boolean
  onExport: () => void
  onExpire: () => void
  onEdit: () => void
  onDelete: () => void
  onClear: () => void
}) {
  const label = 'hidden sm:inline'
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 motion-safe:animate-rise-in">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
      >
        <span className="px-2 text-sm font-medium tabular-nums">{count} selected</span>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="sm" onClick={onExport} title="Export CSV"><Download /><span className={label}>Export</span></Button>
        {!readOnly && (
          <>
            <Button variant="ghost" size="sm" onClick={onExpire} title="Expire now"><TimerOff /><span className={label}>Expire</span></Button>
            <Button variant="ghost" size="sm" onClick={onEdit} title="Edit"><SlidersHorizontal /><span className={label}>Edit</span></Button>
            <Button variant="ghost" size="sm" onClick={onDelete} title="Delete" className="text-destructive hover:bg-destructive/10 hover:text-destructive">
              <Trash2 /><span className={label}>Delete</span>
            </Button>
          </>
        )}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Button variant="ghost" size="icon" className="size-8" onClick={onClear} aria-label="Clear selection" title="Clear selection">
          <X />
        </Button>
      </div>
    </div>
  )
}

function QrDialog({ code, onClose }: { code: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(code)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="font-mono">/{code}</DialogTitle>
          <DialogDescription>Scan to open this short link.</DialogDescription>
        </DialogHeader>
        {code && (
          <div className="grid justify-items-center gap-4">
            <img src={`/api/qr/${code}`} alt={`QR code for /${code}`} className="rounded-lg border bg-white p-2" width={256} height={256} />
            <Button variant="outline" className="w-full" asChild>
              <a href={`/api/qr/${code}`} download={`${code}.png`}><Download /> Download PNG</a>
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
