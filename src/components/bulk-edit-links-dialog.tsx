import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { bulkUpdateLinks } from '~/lib/links'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select } from './ui/select'
import { Switch } from './ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: string[]
  users: { id: string; name: string; email: string; role: string; deactivatedAt: Date | null }[]
  isAdmin: boolean
  onSaved: () => void
}

/** A switch that reveals its field; off means "leave this as it is". */
function OptionalChange({ id, label, checked, onChange, children }: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
      <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
        {label}
        <Switch id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {checked && children}
    </div>
  )
}

export function BulkEditLinksDialog({ open, onOpenChange, ids, users, isAdmin, onSaved }: Props) {
  const [status, setStatus] = useState('')
  const [changeStarts, setChangeStarts] = useState(false)
  const [startsAt, setStartsAt] = useState('')
  const [changeExpiry, setChangeExpiry] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')
  const [addTags, setAddTags] = useState('')
  const [removeTags, setRemoveTags] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setStatus(''); setChangeStarts(false); setStartsAt(''); setChangeExpiry(false); setExpiresAt('')
    setAddTags(''); setRemoveTags(''); setOwnerId('')
  }, [open])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    try {
      const result = await bulkUpdateLinks({ data: {
        ids,
        ...(status ? { status: status as 'active' | 'paused' } : {}),
        ...(changeStarts ? { startsAt: startsAt ? new Date(startsAt).toISOString() : null } : {}),
        ...(changeExpiry ? { expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null } : {}),
        addTags: addTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        removeTags: removeTags.split(',').map((tag) => tag.trim()).filter(Boolean),
        ...(ownerId ? { ownerId } : {}),
      } })
      toast.success(`${result.count} link${result.count === 1 ? '' : 's'} updated`)
      onOpenChange(false)
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Bulk update failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {ids.length} link{ids.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>Only the fields you fill in or switch on will change.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="bulk-status">Status</Label>
            <Select id="bulk-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">No change</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </Select>
          </div>
          <OptionalChange id="bulk-starts" label="Change scheduled start" checked={changeStarts} onChange={setChangeStarts}>
            <Input type="datetime-local" aria-label="Scheduled start" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
            {!startsAt && <p className="text-xs text-muted-foreground">Leaving this blank removes the scheduled start.</p>}
          </OptionalChange>
          <OptionalChange id="bulk-expiry" label="Change expiry" checked={changeExpiry} onChange={setChangeExpiry}>
            <Input type="datetime-local" aria-label="Expiry" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
            {!expiresAt && <p className="text-xs text-muted-foreground">Leaving this blank removes the expiry.</p>}
          </OptionalChange>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="add-tags">Add tags</Label>
              <Input id="add-tags" placeholder="campaign, q4" value={addTags} onChange={(event) => setAddTags(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="remove-tags">Remove tags</Label>
              <Input id="remove-tags" placeholder="draft" value={removeTags} onChange={(event) => setRemoveTags(event.target.value)} />
            </div>
          </div>
          {isAdmin && (
            <div className="grid gap-2">
              <Label htmlFor="owner">Transfer ownership</Label>
              <Select id="owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                <option value="">No change</option>
                {users.filter((user) => !user.deactivatedAt && user.role !== 'guest').map((user) => (
                  <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                ))}
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? 'Updating…' : 'Apply changes'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
