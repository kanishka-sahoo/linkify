import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Fingerprint, KeyRound, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { authClient } from '~/lib/auth-client'
import { createApiKey, deleteApiKey, listApiKeys } from '~/lib/links'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'

export const Route = createFileRoute('/dashboard/settings')({
  loader: async () => {
    const keys = await listApiKeys()
    return { keys }
  },
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="grid max-w-3xl gap-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <TwoFactorCard />
      <PasskeysCard />
      <ApiKeysCard />
    </div>
  )
}

// ---------- TOTP 2FA ----------

function TwoFactorCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [totpURI, setTotpURI] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      setEnabled(Boolean((data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled))
    })
  }, [])

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
  }

  async function disable() {
    const pwd = prompt('Enter your password to disable 2FA')
    if (!pwd) return
    const { error } = await authClient.twoFactor.disable({ password: pwd })
    if (error) return toast.error(error.message ?? 'Failed to disable 2FA')
    toast.success('2FA disabled')
    setEnabled(false)
  }

  const otpauthUrl = totpURI
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpURI)}`
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" /> Two-factor authentication
        </CardTitle>
        <CardDescription>Require a TOTP code from an authenticator app at sign-in.</CardDescription>
      </CardHeader>
      <CardContent>
        {enabled === null ? null : enabled ? (
          <div className="flex items-center gap-3">
            <Badge>Enabled</Badge>
            <Button variant="outline" size="sm" onClick={disable}>Disable</Button>
          </div>
        ) : totpURI ? (
          <form onSubmit={verify} className="grid max-w-xs gap-3">
            <p className="text-sm text-muted-foreground">
              Scan this QR code with your authenticator app, then enter the 6-digit code.
            </p>
            {otpauthUrl && <img src={otpauthUrl} alt="TOTP QR code" width={180} height={180} className="rounded-md border bg-white p-2" />}
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
                id="twofa-password" type="password" value={password}
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

// ---------- Passkeys ----------

function PasskeysCard() {
  const [passkeys, setPasskeys] = useState<{ id: string; name?: string | null; createdAt?: Date | null }[]>([])

  const refresh = () =>
    authClient.passkey.listUserPasskeys().then(({ data }) => setPasskeys(data ?? []))

  useEffect(() => { refresh() }, [])

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
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
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

  async function create(e: React.FormEvent) {
    e.preventDefault()
    try {
      const row = await createApiKey({ data: { name } })
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
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell>{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'never'}
                  </TableCell>
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
