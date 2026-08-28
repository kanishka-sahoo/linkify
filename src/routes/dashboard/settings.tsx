import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Activity, Copy, Fingerprint, KeyRound, Laptop, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import QRCode from 'qrcode'
import { authClient } from '~/lib/auth-client'
import { createApiKey, deleteApiKey } from '~/lib/links'
import { changeMyPassword, getSettingsData, revokeOtherSessions, revokeSession } from '~/lib/settings'
import { API_SCOPES, type ApiScope } from '~/lib/api-scopes'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { LocalTime } from '~/components/local-time'

export const Route = createFileRoute('/dashboard/settings')({
  loader: () => getSettingsData(),
  component: SettingsPage,
})

function SettingsPage() {
  const router = useRouter()
  const { mustChangePassword, twoFactorRequired } = Route.useLoaderData()

  // Once the last requirement is met the rest of the app opens up; until then
  // the dashboard guard would just send the user back here.
  function completed(requirement: 'password' | 'twoFactor') {
    const remaining = requirement === 'password' ? twoFactorRequired : mustChangePassword
    const wasRequired = requirement === 'password' ? mustChangePassword : twoFactorRequired
    if (wasRequired && !remaining) router.navigate({ to: '/dashboard' })
    else router.invalidate()
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {mustChangePassword && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 text-sm">
          Change the temporary password before using the rest of the application.
        </div>
      )}
      {twoFactorRequired && (
        <div className="rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 text-sm">
          Admin accounts must turn on two-factor authentication before using the rest of the application.
          Set it up below with an authenticator app.
        </div>
      )}
      <PasswordCard onChanged={() => completed('password')} />
      <TwoFactorCard onEnabled={() => completed('twoFactor')} />
      <PasskeysCard />
      <SessionsCard />
      <ApiKeysCard />
      <SecurityActivityCard />
    </div>
  )
}

function PasswordCard({ onChanged }: { onChanged: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await changeMyPassword({ data: { currentPassword, newPassword } })
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Password changed and other sessions revoked')
      onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Password</CardTitle>
        <CardDescription>Use at least 12 characters. Changing it signs out every other session.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid max-w-sm gap-3">
          <Input type="password" autoComplete="current-password" maxLength={128} placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          <Input type="password" autoComplete="new-password" minLength={12} maxLength={128} placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <div><Button type="submit" disabled={loading}>{loading ? 'Changing…' : 'Change password'}</Button></div>
        </form>
      </CardContent>
    </Card>
  )
}

// ---------- TOTP 2FA ----------

function TwoFactorCard({ onEnabled }: { onEnabled: () => void }) {
  const { twoFactorEnabled } = Route.useLoaderData()
  const [enabled, setEnabled] = useState(twoFactorEnabled)
  const [password, setPassword] = useState('')
  const [totpURI, setTotpURI] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!totpURI) {
      setQrDataUrl(null)
      return
    }
    QRCode.toDataURL(totpURI, { width: 180, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (active) setQrDataUrl(url) })
      .catch(() => { if (active) toast.error('Could not render the TOTP QR code') })
    return () => { active = false }
  }, [totpURI])

  async function enable(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { data, error } = await authClient.twoFactor.enable({ password })
    setLoading(false)
    if (error) return toast.error(error.message ?? 'Failed to enable 2FA')
    setTotpURI(data?.totpURI ?? null)
    if (data?.backupCodes?.length) {
      toast.info(`Backup codes: ${data.backupCodes.join(', ')} — save these somewhere safe`, { duration: 30000 })
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await authClient.twoFactor.verifyTotp({ code })
    setLoading(false)
    if (error) return toast.error(error.message ?? 'Invalid code')
    toast.success('Two-factor authentication enabled')
    setEnabled(true)
    setTotpURI(null)
    setPassword('')
    setCode('')
    onEnabled()
  }

  async function disable() {
    const pwd = prompt('Enter your password to disable 2FA')
    if (!pwd) return
    const { error } = await authClient.twoFactor.disable({ password: pwd })
    if (error) return toast.error(error.message ?? 'Failed to disable 2FA')
    toast.success('2FA disabled')
    setEnabled(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Two-factor authentication
        </CardTitle>
        <CardDescription>Require a TOTP code from an authenticator app at sign-in.</CardDescription>
      </CardHeader>
      <CardContent>
        {enabled ? (
          <div className="flex items-center gap-3">
            <Badge>Enabled</Badge>
            <Button variant="outline" size="sm" onClick={disable}>Disable</Button>
          </div>
        ) : totpURI ? (
          <form onSubmit={verify} className="grid max-w-xs gap-3">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app, then enter the 6-digit code.
            </p>
            {qrDataUrl && <img src={qrDataUrl} alt="TOTP QR code" width={180} height={180} className="rounded-md border bg-white p-2" />}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Manual entry URI</summary>
              <code className="break-all">{totpURI}</code>
            </details>
            <Input
              inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="123456"
              value={code} onChange={(e) => setCode(e.target.value)} required
            />
            <Button type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify & enable'}</Button>
          </form>
        ) : (
          <form onSubmit={enable} className="grid max-w-xs gap-3">
            <div className="grid gap-2">
              <Label htmlFor="twofa-password">Confirm your password</Label>
              <Input
                id="twofa-password" type="password" maxLength={128} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} required
              />
            </div>
            <Button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Set up 2FA'}</Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function SessionsCard() {
  const router = useRouter()
  const { sessions } = Route.useLoaderData()

  async function revoke(id: string) {
    await revokeSession({ data: { id } })
    toast.success('Session revoked')
    router.invalidate()
  }

  async function revokeOthers() {
    await revokeOtherSessions()
    toast.success('Other sessions revoked')
    router.invalidate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Laptop className="h-5 w-5" /> Sessions</CardTitle>
        <CardDescription>Sessions expire after 24 hours of inactivity.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Table>
          <TableHeader><TableRow><TableHead>Device</TableHead><TableHead>IP</TableHead><TableHead>Last active</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell className="max-w-[260px] truncate" title={session.userAgent ?? ''}>
                  {session.current ? <Badge className="mr-2">current</Badge> : null}
                  {session.userAgent?.slice(0, 60) ?? 'Unknown device'}
                </TableCell>
                <TableCell className="font-mono text-xs">{session.ipAddress ?? '—'}</TableCell>
                <TableCell><LocalTime value={session.updatedAt} /></TableCell>
                <TableCell>{!session.current && <Button variant="ghost" size="icon" onClick={() => revoke(session.id)}><Trash2 className="text-destructive" /></Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div><Button variant="outline" size="sm" onClick={revokeOthers}>Revoke other sessions</Button></div>
      </CardContent>
    </Card>
  )
}

// ---------- Passkeys ----------

function PasskeysCard() {
  const router = useRouter()
  const { passkeys } = Route.useLoaderData()

  const refresh = () => router.invalidate()

  async function add() {
    const name = prompt('Name this passkey (e.g. "MacBook Touch ID")') ?? undefined
    const { error } = await authClient.passkey.addPasskey({ name })
    if (error) return toast.error(error.message ?? 'Could not add passkey')
    toast.success('Passkey added')
    refresh()
  }

  async function remove(id: string) {
    if (!confirm('Remove this passkey?')) return
    const { error } = await authClient.passkey.deletePasskey({ id })
    if (error) return toast.error(error.message ?? 'Could not remove passkey')
    toast.success('Passkey removed')
    refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-5 w-5" /> Passkeys
        </CardTitle>
        <CardDescription>Sign in with biometrics or a security key.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No passkeys registered yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {passkeys.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.name ?? 'Passkey'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.createdAt ? <LocalTime value={p.createdAt} dateOnly /> : '—'}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove(p.id)}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <Button variant="outline" size="sm" onClick={add}>
            <Plus /> Add a passkey
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- API keys ----------

function ApiKeysCard() {
  const router = useRouter()
  const keys = Route.useLoaderData().keys
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [expiresInDays, setExpiresInDays] = useState(90)
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set(API_SCOPES))

  async function create(e: React.FormEvent) {
    e.preventDefault()
    try {
      const row = await createApiKey({ data: { name, expiresInDays, scopes: [...scopes] } })
      setNewKey(row.key)
      setName('')
      router.invalidate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create key')
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this API key? Requests using it will fail immediately.')) return
    await deleteApiKey({ data: { id } })
    toast.success('Key deleted')
    router.invalidate()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> API keys
        </CardTitle>
        <CardDescription>
          Use <code className="text-xs">Authorization: Bearer &lt;key&gt;</code> against <code className="text-xs">/api/v1/*</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {keys.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>
                    <div>{k.name}</div>
                    <div className="text-xs text-muted-foreground">{k.scopes.join(', ')}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.lastUsedAt ? <LocalTime value={k.lastUsedAt} dateOnly /> : 'never'}
                  </TableCell>
                  <TableCell className="text-muted-foreground"><LocalTime value={k.expiresAt} dateOnly /></TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => remove(k.id)}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Plus /> New API key
          </Button>
        </div>

        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setNewKey(null) }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{newKey ? 'Key created' : 'New API key'}</DialogTitle>
              <DialogDescription>
                {newKey ? 'Copy this key now — it will never be shown again.' : 'Give the key a name so you remember what uses it.'}
              </DialogDescription>
            </DialogHeader>
            {newKey ? (
              <div className="grid gap-3">
                <code className="break-all rounded-md border bg-muted p-3 font-mono text-sm">{newKey}</code>
                <Button
                  variant="outline"
                  onClick={async () => { await navigator.clipboard.writeText(newKey); toast.success('Copied') }}
                >
                  <Copy /> Copy key
                </Button>
              </div>
            ) : (
              <form onSubmit={create} className="grid gap-3">
                <Input placeholder="e.g. CI deploy script" value={name} onChange={(e) => setName(e.target.value)} required />
                <div className="grid gap-2">
                  <Label htmlFor="key-expiry">Expires in days</Label>
                  <Input id="key-expiry" type="number" min={1} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} required />
                </div>
                <div className="grid gap-2">
                  <Label>Permissions</Label>
                  {API_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={scopes.has(scope)}
                        onChange={(e) => {
                          const next = new Set(scopes)
                          if (e.target.checked) next.add(scope); else next.delete(scope)
                          setScopes(next)
                        }}
                      />
                      {scope}
                    </label>
                  ))}
                </div>
                <DialogFooter>
                  <Button type="submit">Create key</Button>
                </DialogFooter>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  )
}

function SecurityActivityCard() {
  const { securityEvents } = Route.useLoaderData()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Security activity</CardTitle>
        <CardDescription>Recent credential and account-sensitive actions.</CardDescription>
      </CardHeader>
      <CardContent>
        {securityEvents.length === 0 ? <p className="text-sm text-muted-foreground">No events recorded yet.</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Event</TableHead><TableHead>IP</TableHead><TableHead>Time</TableHead></TableRow></TableHeader>
            <TableBody>{securityEvents.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-mono text-xs">{event.action}</TableCell>
                <TableCell className="font-mono text-xs">{event.ip ?? '—'}</TableCell>
                <TableCell><LocalTime value={event.createdAt} /></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
