import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Eye, Plus, ShieldMinus, ShieldPlus, Trash2, UserCheck, UserX, Users } from 'lucide-react'
import { authClient } from '~/lib/auth-client'
import {
  createGuest, createUser, deactivateUser, deleteUser, listUsers, reactivateUser, setGuestAccess, setUserRole,
  takeOverLinks,
} from '~/lib/users'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { Checkbox } from '~/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { LocalTime } from '~/components/local-time'

export const Route = createFileRoute('/dashboard/users')({
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'admin') throw redirect({ to: '/dashboard' })
  },
  loader: async () => {
    const users = await listUsers()
    return { users }
  },
  component: UsersPage,
})

const plural = (count: number) => `${count} link${count === 1 ? '' : 's'}`

type UserRow = Awaited<ReturnType<typeof listUsers>>[number]

function UsersPage() {
  const router = useRouter()
  const { users } = Route.useLoaderData()
  const [myId, setMyId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [guestOpen, setGuestOpen] = useState(false)
  const [accessFor, setAccessFor] = useState<UserRow | null>(null)
  const owners = users.filter((u) => u.role !== 'guest')

  useEffect(() => {
    authClient.getSession().then(({ data }) => setMyId(data?.user.id ?? null))
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await createUser({ data: { name, email, password } })
      toast.success(`Account created for ${email}`)
      setOpen(false)
      setName('')
      setEmail('')
      setPassword('')
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  async function remove(id: string, userEmail: string, linkCount: number) {
    const links = linkCount === 0 ? '' : ` Their ${plural(linkCount)} and analytics move to you.`
    if (!confirm(`Delete the account for ${userEmail}?${links} Their API keys are deleted and their sessions end immediately.`)) return
    try {
      const { transferred } = await deleteUser({ data: { id } })
      toast.success(transferred ? `Account deleted; ${plural(transferred)} moved to you` : 'Account deleted')
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete user')
    }
  }

  async function takeOver(id: string, userEmail: string, linkCount: number) {
    if (!confirm(`Take over ${userEmail}'s ${plural(linkCount)}? You become the owner; they lose access.`)) return
    try {
      const { count } = await takeOverLinks({ data: { id } })
      toast.success(`${plural(count)} moved to you`)
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to take over links')
    }
  }

  async function deactivate(id: string, userEmail: string) {
    if (!confirm(`Deactivate ${userEmail}? They're signed out and can't sign in or use API keys. Their links keep working until you take them over.`)) return
    try {
      await deactivateUser({ data: { id } })
      toast.success('Account deactivated')
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate user')
    }
  }

  async function reactivate(id: string) {
    try {
      await reactivateUser({ data: { id } })
      toast.success('Account reactivated')
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reactivate user')
    }
  }

  async function toggleRole(id: string, userEmail: string, currentRole: string) {
    const next = currentRole === 'admin' ? 'user' : 'admin'
    const verb = next === 'admin' ? 'grant admin access to' : 'revoke admin access from'
    if (!confirm(`Really ${verb} ${userEmail}?`)) return
    try {
      await setUserRole({ data: { id, role: next } })
      toast.success(next === 'admin' ? 'Admin access granted' : 'Admin access revoked')
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change role')
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-xl font-semibold">Users</h1>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Team members
          </CardTitle>
          <CardDescription>
            Admins can manage members and invite new ones. New members should enable 2FA on first login.
            Deactivate admins who leave; deleting a user moves their links to you.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead className="text-right">Links</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-[140px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} className={u.deactivatedAt ? 'text-muted-foreground' : undefined}>
                  <TableCell>
                    {u.name} {u.id === myId && <Badge variant="secondary" className="ml-1">you</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    {u.role === 'admin'
                      ? <Badge>admin</Badge>
                      : u.role === 'guest'
                        ? <Badge variant="secondary" title={guestAccessLabel(u, users)}>guest · {u.guestOwnerIds.length} account{u.guestOwnerIds.length === 1 ? '' : 's'}</Badge>
                        : <Badge variant="outline">user</Badge>}
                    {u.deactivatedAt && <Badge variant="secondary" className="ml-1">deactivated</Badge>}
                  </TableCell>
                  <TableCell>
                    {u.twoFactorEnabled ? <Badge>on</Badge> : <Badge variant="outline">off</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{u.linkCount}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <LocalTime value={u.createdAt} dateOnly />
                  </TableCell>
                  <TableCell>
                    {u.id !== myId && (
                      <div className="flex gap-1">
                        {u.linkCount > 0 && (
                          <Button variant="ghost" size="icon" title="Take over links" onClick={() => takeOver(u.id, u.email, u.linkCount)}>
                            <ArrowRightLeft />
                          </Button>
                        )}
                        {u.role === 'guest' && (
                          <Button variant="ghost" size="icon" title="Change which accounts this guest can view" onClick={() => setAccessFor(u)}>
                            <Eye />
                          </Button>
                        )}
                        {!u.deactivatedAt && u.role !== 'guest' && (
                          <Button
                            variant="ghost" size="icon"
                            title={u.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                            onClick={() => toggleRole(u.id, u.email, u.role)}
                          >
                            {u.role === 'admin'
                              ? <ShieldMinus className="text-orange-500" />
                              : <ShieldPlus className="text-emerald-500" />}
                          </Button>
                        )}
                        {u.deactivatedAt ? (
                          <Button variant="ghost" size="icon" title="Reactivate account" onClick={() => reactivate(u.id)}>
                            <UserCheck className="text-emerald-500" />
                          </Button>
                        ) : u.role === 'admin' && (
                          <Button variant="ghost" size="icon" title="Deactivate admin" onClick={() => deactivate(u.id, u.email)}>
                            <UserX className="text-orange-500" />
                          </Button>
                        )}
                        {(u.role !== 'admin' || u.deactivatedAt) && (
                          <Button variant="ghost" size="icon" title="Delete account" onClick={() => remove(u.id, u.email, u.linkCount)}>
                            <Trash2 className="text-destructive" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus /> Add member
            </Button>
            <Button variant="outline" size="sm" onClick={() => setGuestOpen(true)}>
              <Eye /> Add guest
            </Button>
          </div>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a team member</DialogTitle>
                <DialogDescription>
                  They can change their password after signing in. Share these credentials securely.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={add} className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="member-name">Name</Label>
                  <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="member-email">Email</Label>
                  <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="member-password">Temporary password</Label>
                  <Input
                    id="member-password" type="password" minLength={12} maxLength={128}
                    value={password} onChange={(e) => setPassword(e.target.value)} required
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <GuestDialog
            open={guestOpen}
            onOpenChange={setGuestOpen}
            owners={owners}
            onSaved={() => router.invalidate()}
          />
          <GuestDialog
            open={Boolean(accessFor)}
            onOpenChange={(next) => { if (!next) setAccessFor(null) }}
            owners={owners}
            guest={accessFor}
            onSaved={() => router.invalidate()}
          />
        </CardContent>
      </Card>
    </div>
  )
}

function guestAccessLabel(guest: UserRow, users: UserRow[]) {
  const emails = users.filter((u) => guest.guestOwnerIds.includes(u.id)).map((u) => u.email)
  return emails.length ? `Can view links of ${emails.join(', ')}` : 'Can view nothing yet'
}

/** Creates a guest, or with `guest` set, edits which accounts it can view. */
function GuestDialog({ open, onOpenChange, owners, guest, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  owners: UserRow[]
  guest?: UserRow | null
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ownerIds, setOwnerIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setEmail('')
    setPassword('')
    setOwnerIds(new Set(guest?.guestOwnerIds ?? []))
  }, [open, guest])

  function toggle(id: string) {
    const next = new Set(ownerIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setOwnerIds(next)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (guest) {
        await setGuestAccess({ data: { id: guest.id, ownerIds: [...ownerIds] } })
        toast.success('Guest access updated')
      } else {
        await createGuest({ data: { name, email, password, ownerIds: [...ownerIds] } })
        toast.success(`Guest account created for ${email}`)
      }
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save guest')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{guest ? `Access for ${guest.email}` : 'Add a guest'}</DialogTitle>
          <DialogDescription>
            Guests can view the links and analytics of the accounts you choose, without visitor IPs or user agents.
            They can't change anything, including their own password, so the credentials are safe to share for a demo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          {!guest && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="guest-name">Name</Label>
                <Input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="guest-email">Email</Label>
                <Input id="guest-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="guest-password">Password</Label>
                <Input
                  id="guest-password" type="password" minLength={12} maxLength={128} autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} required
                />
              </div>
            </>
          )}
          <div className="grid gap-2">
            <Label>Accounts this guest can view</Label>
            <div className="grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3">
              {owners.map((owner) => (
                <label key={owner.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={ownerIds.has(owner.id)} onChange={() => toggle(owner.id)} />
                  <span>{owner.name}</span>
                  <span className="text-muted-foreground">{owner.email}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{plural(owner.linkCount)}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : guest ? 'Save access' : 'Create guest'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
