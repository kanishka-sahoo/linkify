import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createLink, updateLink, type LinkInput, type LinkStatus } from '~/lib/links'
import type { SafeLink as LinkRow } from '~/lib/links'
import { applyCampaignParams, EMPTY_CAMPAIGN, readCampaignParams, UTM_FIELDS, type CampaignParams } from '~/lib/campaign'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '~/components/ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits this link; otherwise it creates a new one. */
  link?: LinkRow | null
  /** Populate from this link but create a new record. */
  duplicate?: boolean
  onSaved: () => void
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

export function LinkFormDialog({ open, onOpenChange, link, duplicate = false, onSaved }: Props) {
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
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      status,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      expiredRedirectUrl: expiredRedirectUrl || null,
      maxClicks: maxClicks ? Number(maxClicks) : null,
      privacyEnabled,
      password: password || undefined,
    }
    try {
      if (editing && link) {
        await updateLink({ data: { ...payload, id: link.id, code, removePassword } })
        toast.success('Link updated')
      } else {
        await createLink({ data: payload })
        toast.success('Link created')
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit link' : duplicate ? 'Duplicate link' : 'Create a short link'}</DialogTitle>
          <DialogDescription>
            {editing ? `Editing /${link?.code}` : duplicate ? `Creating a copy of /${link?.code}` : 'Paste a long URL and optionally customize the short code.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="url">Destination URL</Label>
            <Input
              id="url"
              type="url"
              placeholder="https://example.com/very/long/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>
          <details className="rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">Campaign parameters (UTM)</summary>
            <div className="mt-3 grid gap-3">
              {presets.length > 0 && (
                <select
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                  defaultValue=""
                  onChange={(event) => {
                    const preset = presets.find((item) => item.name === event.target.value)
                    if (preset) setCampaign(preset.values)
                  }}
                >
                  <option value="">Load a saved preset…</option>
                  {presets.map((preset) => <option key={preset.name}>{preset.name}</option>)}
                </select>
              )}
              <div className="grid grid-cols-2 gap-3">
                {UTM_FIELDS.map((field) => (
                  <div key={field} className="grid gap-1.5">
                    <Label htmlFor={field}>{UTM_LABELS[field]}</Label>
                    <Input
                      id={field}
                      value={campaign[field]}
                      onChange={(event) => setCampaign({ ...campaign, [field]: event.target.value })}
                    />
                  </div>
                ))}
              </div>
              <div><Button type="button" size="sm" variant="outline" onClick={savePreset}>Save as preset</Button></div>
              {destinationPreview && <p className="break-all text-xs text-muted-foreground">Preview: {destinationPreview}</p>}
            </div>
          </details>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="code">Custom code</Label>
              <Input
                id="code"
                placeholder={editing ? '' : 'random'}
                pattern="[a-zA-Z0-9_\-]{1,64}"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required={editing}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="title">Title (optional)</Label>
              <Input id="title" placeholder="Launch post" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tags">Tags (optional)</Label>
            <Input
              id="tags"
              placeholder="launch, twitter, q3"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Comma-separated, up to 10.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="starts">Starts (optional)</Label>
              <Input id="starts" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expires">Expires (optional)</Label>
              <Input id="expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="status">Status</Label>
              <select id="status" className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as LinkStatus)}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="max-clicks">Click limit (optional)</Label>
              <Input id="max-clicks" type="number" min={1} max={1_000_000_000} value={maxClicks} onChange={(e) => setMaxClicks(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="expired-redirect">Inactive fallback URL (optional)</Label>
            <Input id="expired-redirect" type="url" placeholder="https://example.com/campaign-ended" value={expiredRedirectUrl} onChange={(e) => setExpiredRedirectUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">Used when paused, not started, expired, or at its click limit.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">
              Password protection {editing && link?.passwordProtected ? '(set — type a new one to change)' : '(optional)'}
            </Label>
            <Input
              id="password"
              type="password"
              placeholder={editing && link?.passwordProtected ? '••••••••' : 'Leave blank for none'}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={removePassword}
            />
            {editing && link?.passwordProtected && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={removePassword}
                  onChange={(e) => setRemovePassword(e.target.checked)}
                />
                Remove password protection
              </label>
            )}
          </div>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input type="checkbox" className="mt-0.5" checked={privacyEnabled} onChange={(e) => setPrivacyEnabled(e.target.checked)} />
            <span><span className="font-medium">Privacy mode</span><span className="block text-xs text-muted-foreground">Keep unique counts but do not retain raw IP, city, or user-agent values.</span></span>
          </label>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : editing ? 'Save changes' : 'Create link'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
