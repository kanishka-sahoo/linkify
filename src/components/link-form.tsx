import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { BarChart3, ChevronRight, Copy, QrCode, Trash2 } from 'lucide-react'
import { createLink, updateLink, type LinkInput, type LinkStatus } from '~/lib/links'
import type { SafeLink as LinkRow } from '~/lib/links'
import { applyCampaignParams, EMPTY_CAMPAIGN, readCampaignParams, UTM_FIELDS, type CampaignParams } from '~/lib/campaign'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Select } from '~/components/ui/select'
import { Switch } from '~/components/ui/switch'
import { Segmented } from '~/components/ui/segmented'
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '~/components/ui/sheet'
import { LocalTime } from '~/components/local-time'
import { ClickUsage, LINK_STATES, StatusBadge, linkState } from '~/components/link-status'
import type { LinkOwner } from '~/components/link-details'
import { cn } from '~/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the sheet shows and edits this link; otherwise it creates a new one. */
  link?: LinkRow | null
  /** Populate from this link but create a new record. */
  duplicate?: boolean
  owner?: LinkOwner
  onSaved: (link: LinkRow) => void
  onShowQr?: (link: LinkRow) => void
  onDelete?: (link: LinkRow) => void
}

function toLocalInputValue(d: Date | string | null | undefined) {
  if (!d) return ''
  const date = new Date(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const UTM_LABELS: Record<keyof CampaignParams, string> = {
  utm_source: 'Source', utm_medium: 'Medium', utm_campaign: 'Campaign',
  utm_term: 'Term', utm_content: 'Content',
}

interface CampaignPreset { name: string; values: CampaignParams }

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

function Field({ id, label, hint, children, className }: {
  id?: string
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid min-w-0 grid-cols-1 content-start gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** A labelled switch row with a description, for on/off settings. */
function ToggleRow({ id, label, description, checked, onChange }: {
  id: string
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border bg-muted/20 p-3">
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
    </label>
  )
}

const optional = <span className="font-normal text-muted-foreground">(optional)</span>

/**
 * One pane to view and change a link, or to create one. Read-only viewers get
 * `LinkDetailsSheet` instead.
 */
export function LinkEditorSheet({ open, onOpenChange, link, duplicate = false, owner, onSaved, onShowQr, onDelete }: Props) {
  const editing = Boolean(link) && !duplicate
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [status, setStatus] = useState<LinkStatus>('active')
  const [expiredRedirectUrl, setExpiredRedirectUrl] = useState('')
  const [maxClicks, setMaxClicks] = useState('')
  const [privacyEnabled, setPrivacyEnabled] = useState(false)
  const [password, setPassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [campaign, setCampaign] = useState<CampaignParams>({ ...EMPTY_CAMPAIGN })
  const [presets, setPresets] = useState<CampaignPreset[]>([])
  const destinationPreview = useMemo(() => {
    try { return applyCampaignParams(url, campaign) } catch { return url }
  }, [url, campaign])
  const campaignCount = UTM_FIELDS.filter((f) => campaign[f]).length
  const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)

  useEffect(() => {
    if (open) {
      setUrl(link?.url ?? '')
      setCode(duplicate ? '' : link?.code ?? '')
      setTitle(link?.title ?? '')
      setTags((link?.tags ?? []).join(', '))
      setExpiresAt(toLocalInputValue(link?.expiresAt))
      setStartsAt(toLocalInputValue(link?.startsAt))
      setStatus(link?.status === 'paused' ? 'paused' : 'active')
      setExpiredRedirectUrl(link?.expiredRedirectUrl ?? '')
      setMaxClicks(link?.maxClicks ? String(link.maxClicks) : '')
      setPrivacyEnabled(link?.privacyEnabled ?? false)
      setPassword('')
      setRemovePassword(false)
      setCampaign(readCampaignParams(link?.url ?? ''))
      try {
        const stored = JSON.parse(localStorage.getItem('linkify-campaign-presets') ?? '[]') as unknown
        setPresets(Array.isArray(stored) ? stored.filter((item): item is CampaignPreset => {
          if (!item || typeof item !== 'object') return false
          const preset = item as Partial<CampaignPreset>
          return typeof preset.name === 'string' && Boolean(preset.values) &&
            UTM_FIELDS.every((field) => typeof preset.values?.[field] === 'string')
        }).slice(-10) : [])
      } catch {
        setPresets([])
      }
    }
  }, [open, link, duplicate])

  function savePreset() {
    const name = prompt('Preset name')?.trim()
    if (!name) return
    const next = [...presets.filter((preset) => preset.name !== name), { name, values: campaign }].slice(-10)
    setPresets(next)
    localStorage.setItem('linkify-campaign-presets', JSON.stringify(next))
    toast.success('Campaign preset saved')
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    let destination: string
    try {
      destination = applyCampaignParams(url, campaign)
    } catch {
      setLoading(false)
      toast.error('Enter a valid destination URL')
      return
    }
    const payload: LinkInput = {
      url: destination,
      code: code || undefined,
      title: title || undefined,
      tags: tagList,
      status,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      expiredRedirectUrl: expiredRedirectUrl || null,
      maxClicks: maxClicks ? Number(maxClicks) : null,
      privacyEnabled,
      password: password || undefined,
    }
    try {
      let saved: LinkRow
      if (editing && link) {
        saved = await updateLink({ data: { ...payload, id: link.id, code, removePassword } })
        toast.success('Link updated')
      } else {
        saved = await createLink({ data: payload })
        toast.success('Link created', { description: `${window.location.host}/${saved.code}` })
      }
      onOpenChange(false)
      onSaved(saved)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const state = link && editing ? linkState(link) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <SheetHeader>
            {editing && link && state ? (
              <>
                <div className="flex min-w-0 items-center gap-2">
                  <SheetTitle className="truncate font-mono">/{link.code}</SheetTitle>
                  <StatusBadge state={state} />
                </div>
                <SheetDescription>{LINK_STATES[state].summary}</SheetDescription>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button" variant="outline" size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(`${window.location.origin}/${link.code}`)
                      toast.success('Short link copied')
                    }}
                  >
                    <Copy /> Copy link
                  </Button>
                  {onShowQr && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onShowQr(link)}>
                      <QrCode /> QR code
                    </Button>
                  )}
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/dashboard/links/$code" params={{ code: link.code }}>
                      <BarChart3 /> Analytics
                    </Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <SheetTitle>{duplicate ? 'Duplicate link' : 'New link'}</SheetTitle>
                <SheetDescription>
                  {duplicate
                    ? <>A copy of <span className="font-mono">/{link?.code}</span> with its own code and analytics.</>
                    : 'Paste a long URL. Everything else is optional.'}
                </SheetDescription>
              </>
            )}
          </SheetHeader>

          <SheetBody className="grid content-start gap-8">
            <FormSection title="Destination">
              <Field id="url" label="Destination URL">
                <Input
                  id="url"
                  type="url"
                  placeholder="https://example.com/very/long/page"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  autoFocus={!editing}
                  required
                />
              </Field>
              <details className="group rounded-lg border bg-muted/20 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium">
                  <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  Campaign parameters
                  <span className="text-xs font-normal text-muted-foreground">
                    {campaignCount > 0 ? `${campaignCount} set` : 'UTM'}
                  </span>
                </summary>
                <div className="grid gap-3 border-t p-3">
                  {presets.length > 0 && (
                    <Select
                      aria-label="Load a saved preset"
                      defaultValue=""
                      onChange={(event) => {
                        const preset = presets.find((item) => item.name === event.target.value)
                        if (preset) setCampaign(preset.values)
                      }}
                    >
                      <option value="">Load a saved preset…</option>
                      {presets.map((preset) => <option key={preset.name}>{preset.name}</option>)}
                    </Select>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {UTM_FIELDS.map((field) => (
                      <Field key={field} id={field} label={UTM_LABELS[field]}>
                        <Input
                          id={field}
                          value={campaign[field]}
                          onChange={(event) => setCampaign({ ...campaign, [field]: event.target.value })}
                        />
                      </Field>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {destinationPreview && campaignCount > 0 && (
                      <p className="min-w-0 break-all text-xs text-muted-foreground">{destinationPreview}</p>
                    )}
                    <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={savePreset}>
                      Save as preset
                    </Button>
                  </div>
                </div>
              </details>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="code" label="Short link" hint={editing ? 'Changing it breaks the old short link.' : 'Leave blank for a random code.'}>
                  <div className="flex h-9 items-center rounded-md border border-input bg-background shadow-xs focus-within:ring-1 focus-within:ring-ring">
                    <span className="max-w-32 shrink-0 truncate border-r bg-muted/40 px-2.5 text-sm leading-[2.125rem] text-muted-foreground">
                      {typeof window === 'undefined' ? '' : window.location.host}/
                    </span>
                    <input
                      id="code"
                      className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm outline-none placeholder:font-sans placeholder:text-muted-foreground/70"
                      placeholder={editing ? '' : 'random'}
                      pattern="[a-zA-Z0-9_\-]{1,64}"
                      title="Letters, numbers, dashes and underscores"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required={editing}
                    />
                  </div>
                </Field>
                <Field id="title" label={<>Title {optional}</>}>
                  <Input id="title" placeholder="Launch post" value={title} onChange={(e) => setTitle(e.target.value)} />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Availability">
              <Field label="Status" hint={status === 'paused' ? 'Paused links don’t redirect until you turn them back on.' : 'Redirects whenever it’s inside its schedule and click limit.'}>
                <Segmented
                  label="Status"
                  className="w-full sm:w-64"
                  value={status}
                  onChange={setStatus}
                  options={[{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="starts" label={<>Starts {optional}</>}>
                  <Input id="starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </Field>
                <Field id="expires" label={<>Expires {optional}</>}>
                  <Input id="expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="max-clicks"
                  label={<>Click limit {optional}</>}
                  hint={editing && link?.maxClicks ? <ClickUsage count={link.clickCount} max={link.maxClicks} className="mt-1 w-full" /> : 'Only redirected visits count.'}
                >
                  <Input
                    id="max-clicks" type="number" min={1} max={1_000_000_000} placeholder="Unlimited"
                    value={maxClicks} onChange={(e) => setMaxClicks(e.target.value)}
                  />
                </Field>
                <Field id="expired-redirect" label={<>Fallback URL {optional}</>} hint="Where visitors go while the link is inactive.">
                  <Input
                    id="expired-redirect" type="url" placeholder="https://example.com/ended"
                    value={expiredRedirectUrl} onChange={(e) => setExpiredRedirectUrl(e.target.value)}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection title="Protection">
              <Field
                id="link-password"
                label={editing && link?.passwordProtected ? 'Password' : <>Password {optional}</>}
                hint={editing && link?.passwordProtected ? 'A password is set. Type a new one to replace it.' : 'Visitors must enter it before they’re redirected.'}
              >
                <Input
                  id="link-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={editing && link?.passwordProtected ? '••••••••' : 'No password'}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={removePassword}
                />
              </Field>
              {editing && link?.passwordProtected && (
                <ToggleRow
                  id="remove-password"
                  label="Remove password"
                  description="Anyone with the short link can open it again."
                  checked={removePassword}
                  onChange={setRemovePassword}
                />
              )}
              <ToggleRow
                id="privacy"
                label="Privacy mode"
                description="Keep unique counts, but don’t store visitor IP, city, or user agent."
                checked={privacyEnabled}
                onChange={setPrivacyEnabled}
              />
            </FormSection>

            <FormSection title="Details">
              <Field id="tags" label={<>Tags {optional}</>} hint="Comma-separated, up to 10.">
                <Input id="tags" placeholder="launch, twitter, q3" value={tags} onChange={(e) => setTags(e.target.value)} />
                {tagList.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tagList.map((t) => (
                      <span key={t} className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-secondary-foreground">{t}</span>
                    ))}
                  </div>
                )}
              </Field>
              {editing && link && (
                <dl className="grid gap-x-4 gap-y-2 rounded-lg border bg-muted/20 p-3 text-sm sm:grid-cols-[auto_1fr]">
                  {owner && (
                    <>
                      <dt className="text-muted-foreground">Owner</dt>
                      <dd className="min-w-0 truncate">
                        {owner.name} <span className="text-muted-foreground">{owner.deactivatedAt ? '(deactivated)' : `(${owner.email})`}</span>
                      </dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Clicks</dt>
                  <dd className="tabular-nums">{link.clickCount.toLocaleString('en-US')}</dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd><LocalTime value={link.createdAt} /></dd>
                  <dt className="text-muted-foreground">Last updated</dt>
                  <dd><LocalTime value={link.updatedAt} /></dd>
                </dl>
              )}
            </FormSection>
          </SheetBody>

          <SheetFooter>
            {editing && link && onDelete && (
              <Button
                type="button" variant="ghost"
                className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(link)}
              >
                <Trash2 /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : editing ? 'Save changes' : 'Create link'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}
