import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createLink, updateLink, type LinkInput } from '~/lib/links'
import type { Link as LinkRow } from '~/lib/schema'
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
  onSaved: () => void
}

function toLocalInputValue(d: Date | string | null | undefined) {
  if (!d) return ''
  const date = new Date(d)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function LinkFormDialog({ open, onOpenChange, link, onSaved }: Props) {
  const editing = Boolean(link)
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [password, setPassword] = useState('')
  const [removePassword, setRemovePassword] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setUrl(link?.url ?? '')
      setCode(link?.code ?? '')
      setTitle(link?.title ?? '')
      setTags((link?.tags ?? []).join(', '))
      setExpiresAt(toLocalInputValue(link?.expiresAt))
      setPassword('')
      setRemovePassword(false)
    }
  }, [open, link])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const payload: LinkInput = {
      url,
      code: code || undefined,
      title: title || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit link' : 'Create a short link'}</DialogTitle>
          <DialogDescription>
            {editing ? `Editing /${link?.code}` : 'Paste a long URL and optionally customize the short code.'}
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
          <div className="grid gap-2">
            <Label htmlFor="expires">Expiry (optional)</Label>
            <Input
              id="expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">
              Password protection {editing && link?.passwordHash ? '(set — type a new one to change)' : '(optional)'}
            </Label>
            <Input
              id="password"
              type="password"
              placeholder={editing && link?.passwordHash ? '••••••••' : 'Leave blank for none'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={removePassword}
            />
            {editing && link?.passwordHash && (
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
