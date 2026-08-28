import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { bulkUpdateLinks } from '~/lib/links'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: string[]
  users: { id: string; name: string; email: string; deactivatedAt: Date | null }[]
  isAdmin: boolean
  onSaved: () => void
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
        <DialogHeader><DialogTitle>Edit {ids.length} links</DialogTitle><DialogDescription>Only fields selected or filled below will change.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2"><Label htmlFor="bulk-status">Status</Label><select id="bulk-status" className="h-9 rounded-md border bg-background px-3 text-sm" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">No change</option><option value="active">Active</option><option value="paused">Paused</option></select></div>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={changeStarts} onChange={() => setChangeStarts(!changeStarts)} /> Change scheduled start</label>
            {changeStarts && <Input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />}
            {changeStarts && !startsAt && <p className="text-xs text-muted-foreground">Leaving this blank removes the scheduled start.</p>}
          </div>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={changeExpiry} onChange={() => setChangeExpiry(!changeExpiry)} /> Change expiry</label>
            {changeExpiry && <Input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />}
            {changeExpiry && !expiresAt && <p className="text-xs text-muted-foreground">Leaving this blank removes the expiry.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2"><Label htmlFor="add-tags">Add tags</Label><Input id="add-tags" placeholder="campaign, q4" value={addTags} onChange={(event) => setAddTags(event.target.value)} /></div>
            <div className="grid gap-2"><Label htmlFor="remove-tags">Remove tags</Label><Input id="remove-tags" placeholder="draft" value={removeTags} onChange={(event) => setRemoveTags(event.target.value)} /></div>
          </div>
          {isAdmin && <div className="grid gap-2"><Label htmlFor="owner">Transfer ownership</Label><select id="owner" className="h-9 rounded-md border bg-background px-3 text-sm" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}><option value="">No change</option>{users.filter((user) => !user.deactivatedAt).map((user) => <option key={user.id} value={user.id}>{user.name} ({user.email})</option>)}</select></div>}
          <DialogFooter><Button type="submit" disabled={loading}>{loading ? 'Updating…' : 'Apply changes'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
