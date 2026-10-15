import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowRightLeft, Eye, MoreHorizontal, Plus, ShieldMinus, ShieldPlus, Trash2, UserCheck, UserX,
} from 'lucide-react'
import { authClient } from '~/lib/auth-client'
import {
  createGuest, createUser, deactivateUser, deleteUser, listUsers, reactivateUser, setGuestAccess, setUserRole,
  takeOverLinks,
} from '~/lib/users'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Checkbox } from '~/components/ui/checkbox'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { LocalTime } from '~/components/local-time'
import { PageHeader, Stat, StatGrid } from '~/components/page-header'
import { cn } from '~/lib/utils'

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
  const [username, setUsername] = useState('')
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
      await createUser({ data: { name, email, username, password } })
      toast.success(`Account created for ${email}`)
      setOpen(false)
      setName('')
      setEmail('')
      setUsername('')
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

  const admins = users.filter((u) => u.role === 'admin' && !u.deactivatedAt).length
  const guests = users.filter((u) => u.role === 'guest').length
  const deactivated = users.filter((u) => u.deactivatedAt).length
  const without2fa = users.filter((u) => !u.twoFactorEnabled && !u.deactivatedAt && u.role !== 'guest').length

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Users"
        description="Invite members, share read-only guest access, and hand over links when someone leaves."
        actions={
          <>
            <Button variant="outline" className="flex-1 bg-background sm:flex-none" onClick={() => setGuestOpen(true)}>
              <Eye /> Add guest
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setOpen(true)}>
              <Plus /> Add member
            </Button>
          </>
        }
      />

      <StatGrid label="Summary" className="sm:grid-cols-4">
        <Stat label="Accounts" value={users.length} hint={deactivated ? `${deactivated} deactivated` : 'All active'} />
        <Stat label="Admins" value={admins} hint="Can manage users" />
        <Stat label="Guests" value={guests} hint="Read-only access" />
        <Stat label="Without 2FA" value={without2fa} hint="Members and admins" />
      </StatGrid>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4">User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden sm:table-cell">2FA</TableHead>
              <TableHead className="hidden text-right md:table-cell">Links</TableHead>
              <TableHead className="hidden lg:table-cell">Joined</TableHead>
              <TableHead className="w-12 pr-4"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className={cn(u.deactivatedAt && 'text-muted-foreground')}>
                <TableCell className="w-full max-w-0 pl-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold uppercase text-secondary-foreground',
                        u.deactivatedAt && 'opacity-50',
                      )}
                    >
                      {(u.name || u.email).slice(0, 1)}
                    </span>
                    <div className="grid min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-medium">{u.name}</span>
                        {u.id === myId && <span className="shrink-0 rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium">You</span>}
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {u.email}{u.username && ` · @${u.username}`}
                      </span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="grid justify-items-start gap-1">
                    <RolePill user={u} users={users} />
                    {u.deactivatedAt && <span className="text-xs text-muted-foreground">Deactivated</span>}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {u.role === 'guest' ? <span className="text-xs text-muted-foreground">—</span> : <Pill on={Boolean(u.twoFactorEnabled)}>{u.twoFactorEnabled ? 'On' : 'Off'}</Pill>}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{u.linkCount.toLocaleString('en-US')}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">
                  <LocalTime value={u.createdAt} dateOnly />
                </TableCell>
                <TableCell className="pr-4">
                  {u.id !== myId && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label={`Actions for ${u.email}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent className="w-56">
                        {u.role === 'guest' && (
                          <DropdownMenuItem onSelect={() => setAccessFor(u)}><Eye /> Change access</DropdownMenuItem>
                        )}
                        {u.linkCount > 0 && (
                          <DropdownMenuItem onSelect={() => takeOver(u.id, u.email, u.linkCount)}>
                            <ArrowRightLeft /> Take over {plural(u.linkCount)}
                          </DropdownMenuItem>
                        )}
                        {!u.deactivatedAt && u.role !== 'guest' && (
                          <DropdownMenuItem onSelect={() => toggleRole(u.id, u.email, u.role)}>
                            {u.role === 'admin' ? <><ShieldMinus /> Revoke admin</> : <><ShieldPlus /> Make admin</>}
                          </DropdownMenuItem>
                        )}
                        {u.deactivatedAt ? (
                          <DropdownMenuItem onSelect={() => reactivate(u.id)}><UserCheck /> Reactivate</DropdownMenuItem>
                        ) : u.role === 'admin' && (
                          <DropdownMenuItem onSelect={() => deactivate(u.id, u.email)}><UserX /> Deactivate</DropdownMenuItem>
                        )}
                        {(u.role !== 'admin' || u.deactivatedAt) && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive onSelect={() => remove(u.id, u.email, u.linkCount)}>
                              <Trash2 /> Delete account
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        New members should turn on 2FA at first sign-in; admins must. Deactivate admins who leave. Deleting a user moves their links to you.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a team member</DialogTitle>
            <DialogDescription>
              They can change their password after signing in. Share these credentials securely.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={add} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="member-name">Name</Label>
                <Input id="member-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <UsernameField id="member-username" value={username} onChange={setUsername} />
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
              <p className="text-xs text-muted-foreground">At least 12 characters. They’re asked to change it at first sign-in.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
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
    </div>
  )
}

const PILL_TONES = {
  admin: 'bg-violet-500/10 text-violet-700 ring-violet-600/20 dark:text-violet-300 dark:ring-violet-400/20',
  on: 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-400 dark:ring-emerald-400/20',
  neutral: 'bg-muted text-muted-foreground ring-border',
}

function Pill({ on, tone, title, children }: { on?: boolean; tone?: keyof typeof PILL_TONES; title?: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        PILL_TONES[tone ?? (on ? 'on' : 'neutral')],
      )}
    >
      {children}
    </span>
  )
}

function RolePill({ user: u, users }: { user: UserRow; users: UserRow[] }) {
  if (u.role === 'admin') return <Pill tone="admin">Admin</Pill>
  if (u.role === 'guest') {
    const n = u.guestOwnerIds.length
    return <Pill title={guestAccessLabel(u, users)}>Guest · {n} account{n === 1 ? '' : 's'}</Pill>
  }
  return <Pill>Member</Pill>
}

function UsernameField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>Username <span className="font-normal text-muted-foreground">(optional)</span></Label>
      <Input
        id={id} autoComplete="off" autoCapitalize="none" spellCheck={false}
        minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" title="Letters, numbers, underscores and dots"
        value={value} onChange={(e) => onChange(e.target.value)}
      />
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [ownerIds, setOwnerIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setEmail('')
    setUsername('')
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
        await createGuest({ data: { name, email, username, password, ownerIds: [...ownerIds] } })
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
        <form onSubmit={submit} className="grid gap-4">
          {!guest && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="guest-name">Name</Label>
                  <Input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <UsernameField id="guest-username" value={username} onChange={setUsername} />
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
            <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
              {owners.map((owner) => (
                <label key={owner.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40">
                  <Checkbox checked={ownerIds.has(owner.id)} onChange={() => toggle(owner.id)} />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-medium">{owner.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{owner.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{plural(owner.linkCount)}</span>
                </label>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving…' : guest ? 'Save access' : 'Create guest'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
