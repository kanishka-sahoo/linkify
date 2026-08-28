import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightLeft, Plus, ShieldMinus, ShieldPlus, Trash2, UserCheck, UserX, Users } from 'lucide-react'
import { authClient } from '~/lib/auth-client'
import {
  createUser, deactivateUser, deleteUser, listUsers, reactivateUser, setUserRole, takeOverLinks,
} from '~/lib/users'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
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

function UsersPage() {
  const router = useRouter()
  const { users } = Route.useLoaderData()
  const [myId, setMyId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

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
                    {u.role === 'admin' ? <Badge>admin</Badge> : <Badge variant="outline">user</Badge>}
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
                        {!u.deactivatedAt && (
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
          <div>
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Plus /> Add member
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
        </CardContent>
      </Card>
    </div>
  )
}
