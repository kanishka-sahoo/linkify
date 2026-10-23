import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, AtSign, Check, Copy, Eye, Fingerprint, KeyRound, Laptop, Plug, Plus, ShieldCheck, Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import QRCode from 'qrcode'
import { authClient } from '~/lib/auth-client'
import { createApiKey, deleteApiKey } from '~/lib/links'
import { changeMyPassword, getSettingsData, revokeOtherSessions, revokeSession } from '~/lib/settings'
import { disconnectApp } from '~/lib/connected-apps'
import { API_SCOPES, type ApiScope } from '~/lib/api-scopes'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Checkbox } from '~/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { LocalTime } from '~/components/local-time'
import { PageHeader } from '~/components/page-header'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/dashboard/settings')({
  loader: () => getSettingsData(),
  component: SettingsPage,
})

function SettingsPage() {
  const router = useRouter()
  const { guest, mustChangePassword, twoFactorRequired } = Route.useLoaderData()

  // Once the last requirement is met the rest of the app opens up; until then
  // the dashboard guard would just send the user back here.
  function completed(requirement: 'password' | 'twoFactor') {
    const remaining = requirement === 'password' ? twoFactorRequired : mustChangePassword
    const wasRequired = requirement === 'password' ? mustChangePassword : twoFactorRequired
    if (wasRequired && !remaining) router.navigate({ to: '/dashboard' })
    else router.invalidate()
  }

  if (guest) {
    return (
      <div className="mx-auto grid max-w-3xl gap-6">
        <PageHeader title="Settings" />
        <div className="flex items-start gap-4 rounded-xl border bg-card p-5 shadow-sm">
          <IconTile icon={Eye} />
          <div className="grid gap-1">
            <h2 className="font-semibold tracking-tight">Read-only guest account</h2>
            <p className="text-sm text-muted-foreground">
              Its password, security settings, and API access are managed by an administrator.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <PageHeader title="Settings" description="Manage how you sign in, your sessions, and API access." />
      {(mustChangePassword || twoFactorRequired) && (
        <div role="alert" className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="grid gap-1">
            <p className="font-medium">Finish securing your account to continue</p>
            {mustChangePassword && <p>Change the temporary password before using the rest of the application.</p>}
            {twoFactorRequired && (
              <p>Admin accounts must turn on two-factor authentication. Set it up below with an authenticator app.</p>
            )}
          </div>
        </div>
      )}
      <SettingsGroup title="Account">
        <UsernameCard />
        <PasswordCard onChanged={() => completed('password')} />
      </SettingsGroup>
      <SettingsGroup title="Security">
        <TwoFactorCard onEnabled={() => completed('twoFactor')} />
        <PasskeysCard />
        <SessionsCard />
      </SettingsGroup>
      <SettingsGroup title="Developers">
        <ConnectedAppsCard />
        <ApiKeysCard />
      </SettingsGroup>
      <SettingsGroup title="Activity">
        <SecurityActivityCard />
      </SettingsGroup>
    </div>
  )
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted/50 text-muted-foreground">
      <Icon className="size-4" />
    </span>
  )
}

/** A settings panel: icon, title, and summary on top; an optional status or action on the right. */
function SettingsCard({ icon, title, description, aside, footer, flush, children }: {
  icon: LucideIcon
  title: string
  description: ReactNode
  aside?: ReactNode
  footer?: ReactNode
  /** Let lists run edge to edge instead of inside the card's padding. */
  flush?: boolean
  children?: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex items-start gap-4 p-5">
        <IconTile icon={icon} />
        <div className="grid min-w-0 flex-1 gap-1">
          <h3 className="font-semibold tracking-tight">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children && <div className={cn(flush ? 'border-t' : 'px-5 pb-5 sm:pl-[4.5rem]')}>{children}</div>}
      {footer && <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-5 py-3">{footer}</div>}
    </section>
  )
}

function StatusPill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        on
          ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-400 dark:ring-emerald-400/20'
          : 'bg-muted text-muted-foreground ring-border',
      )}
    >
      <span className={cn('size-1.5 rounded-full', on ? 'bg-emerald-500' : 'bg-muted-foreground/50')} aria-hidden />
      {children}
    </span>
  )
}

function ListEmpty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-6 text-center text-sm text-muted-foreground">{children}</p>
}

/** "Chrome on macOS" from a user-agent string; good enough to tell your own devices apart. */
function describeAgent(ua: string | null) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? ua.slice(0, 40)
}

function UsernameCard() {
  const router = useRouter()
  const { username: current } = Route.useLoaderData()
  const [username, setUsername] = useState(current ?? '')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await authClient.updateUser({ username: username.trim(), displayUsername: username.trim() })
    setLoading(false)
    if (error) return toast.error(error.message ?? 'Could not change username')
    toast.success('Username saved')
    router.invalidate()
  }

  return (
    <SettingsCard
      icon={AtSign}
      title="Username"
      description="Sign in with this instead of your email. Letters, numbers, underscores and dots."
    >
      <form onSubmit={submit} className="flex max-w-sm gap-2">
        <Input
          autoComplete="username" autoCapitalize="none" spellCheck={false}
          minLength={3} maxLength={30} pattern="[A-Za-z0-9_.]+" placeholder="Username"
          value={username} onChange={(e) => setUsername(e.target.value)} required
        />
        <Button type="submit" disabled={loading || username.trim() === (current ?? '')}>
          {loading ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </SettingsCard>
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
    <SettingsCard
      icon={KeyRound}
      title="Password"
      description="Use at least 12 characters. Changing it signs out every other session."
    >
      <form onSubmit={submit} className="grid max-w-sm gap-3">
        <div className="grid gap-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input id="current-password" type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
        </div>
        <div><Button type="submit" disabled={loading}>{loading ? 'Changing…' : 'Change password'}</Button></div>
      </form>
    </SettingsCard>
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
    <SettingsCard
      icon={ShieldCheck}
      title="Two-factor authentication"
      description="Require a code from an authenticator app at sign-in."
      aside={<StatusPill on={enabled}>{enabled ? 'On' : 'Off'}</StatusPill>}
      footer={enabled && <Button variant="outline" size="sm" onClick={disable}>Turn off</Button>}
    >
      {enabled ? null : totpURI ? (
        <form onSubmit={verify} className="grid max-w-xs gap-3">
          <p className="text-sm text-muted-foreground">
            Scan this QR code with your authenticator app, then enter the 6-digit code.
          </p>
          {qrDataUrl && <img src={qrDataUrl} alt="TOTP QR code" width={180} height={180} className="rounded-xl border bg-white p-2 shadow-sm" />}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Manual entry URI</summary>
            <code className="break-all">{totpURI}</code>
          </details>
          <Input
            inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="123456"
            value={code} onChange={(e) => setCode(e.target.value)} required
          />
          <div><Button type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify & enable'}</Button></div>
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
          <div><Button type="submit" disabled={loading}>{loading ? 'Loading…' : 'Set up 2FA'}</Button></div>
        </form>
      )}
    </SettingsCard>
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
    <SettingsCard
      icon={Laptop}
      title="Sessions"
      description="Devices signed in to your account. Sessions expire after 24 hours of inactivity."
      flush
      footer={sessions.length > 1 && <Button variant="outline" size="sm" onClick={revokeOthers}>Sign out other sessions</Button>}
    >
      <ul className="divide-y">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-3 px-5 py-3">
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate" title={session.userAgent ?? ''}>{describeAgent(session.userAgent)}</span>
                {session.current && <StatusPill on>This device</StatusPill>}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                <span className="font-mono">{session.ipAddress ?? 'Unknown IP'}</span> · Active <LocalTime value={session.updatedAt} />
              </div>
            </div>
            {!session.current && (
              <Button
                variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive"
                title="Sign out this session" aria-label="Sign out this session" onClick={() => revoke(session.id)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SettingsCard>
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
    <SettingsCard
      icon={Fingerprint}
      title="Passkeys"
      description="Sign in with biometrics or a security key instead of a password."
      flush
      footer={<Button variant="outline" size="sm" onClick={add}><Plus /> Add a passkey</Button>}
    >
      {passkeys.length === 0 ? <ListEmpty>No passkeys yet.</ListEmpty> : (
        <ul className="divide-y">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3">
              <div className="grid min-w-0 flex-1 gap-0.5">
                <span className="truncate text-sm font-medium">{p.name ?? 'Passkey'}</span>
                <span className="text-xs text-muted-foreground">
                  {p.createdAt ? <>Added <LocalTime value={p.createdAt} dateOnly /></> : 'Added date unknown'}
                </span>
              </div>
              <Button
                variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive"
                title="Remove passkey" aria-label={`Remove ${p.name ?? 'passkey'}`} onClick={() => remove(p.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}

// ---------- Connected apps ----------

function ConnectedAppsCard() {
  const router = useRouter()
  const { apps, mcpUrl } = Route.useLoaderData()

  async function disconnect(id: string, name: string) {
    if (!confirm(`Disconnect ${name}? It will lose access immediately.`)) return
    await disconnectApp({ data: { id } })
    toast.success('App disconnected')
    router.invalidate()
  }

  return (
    <SettingsCard
      icon={Plug}
      title="Connected apps"
      description={<>AI assistants you've signed in to the MCP server with, such as Claude or ChatGPT. Add <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{mcpUrl}</code> as a custom connector to connect one.</>}
      flush
    >
      {apps.length === 0 ? <ListEmpty>No apps connected.</ListEmpty> : (
        <ul className="divide-y">
          {apps.map((app) => (
            <li key={app.id} className="flex items-center gap-3 px-5 py-3">
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="truncate text-sm font-medium">{app.name}</span>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{app.scopes.join(', ')}</span>
                  <span>Connected <LocalTime value={app.createdAt} dateOnly /></span>
                  <span>Last used {app.lastUsedAt ? <LocalTime value={app.lastUsedAt} dateOnly /> : 'never'}</span>
                </div>
              </div>
              <Button
                variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive"
                title="Disconnect" aria-label={`Disconnect ${app.name}`} onClick={() => disconnect(app.id, app.name)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
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
    <SettingsCard
      icon={KeyRound}
      title="API keys"
      description={<>Use <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">Authorization: Bearer &lt;key&gt;</code> against <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/v1/*</code> and the MCP server.</>}
      flush
      footer={<Button variant="outline" size="sm" onClick={() => setOpen(true)}><Plus /> New API key</Button>}
    >
      {keys.length === 0 ? <ListEmpty>No API keys yet.</ListEmpty> : (
        <ul className="divide-y">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-5 py-3">
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{k.name}</span>
                  <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{k.keyPrefix}…</code>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{k.scopes.join(', ')}</span>
                  <span>Last used {k.lastUsedAt ? <LocalTime value={k.lastUsedAt} dateOnly /> : 'never'}</span>
                  <span>Expires <LocalTime value={k.expiresAt} dateOnly /></span>
                </div>
              </div>
              <Button
                variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive"
                title="Delete key" aria-label={`Delete ${k.name}`} onClick={() => remove(k.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

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
              <code className="break-all rounded-lg border bg-muted/50 p-3 font-mono text-sm">{newKey}</code>
              <Button
                variant="outline"
                onClick={async () => { await navigator.clipboard.writeText(newKey); toast.success('Copied') }}
              >
                <Copy /> Copy key
              </Button>
            </div>
          ) : (
            <form onSubmit={create} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="key-name">Name</Label>
                <Input id="key-name" placeholder="e.g. CI deploy script" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="key-expiry">Expires in days</Label>
                <Input id="key-expiry" type="number" min={1} max={365} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))} required />
              </div>
              <div className="grid gap-2">
                <Label>Permissions</Label>
                <div className="grid gap-2 rounded-lg border p-3">
                  {API_SCOPES.map((scope) => (
                    <label key={scope} className="flex items-center gap-2 font-mono text-sm">
                      <Checkbox
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
              </div>
              <DialogFooter>
                <Button type="submit">Create key</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}

function SecurityActivityCard() {
  const { securityEvents } = Route.useLoaderData()
  return (
    <SettingsCard icon={Activity} title="Security activity" description="Recent sign-ins, credential changes, and other sensitive actions." flush>
      {securityEvents.length === 0 ? <ListEmpty>No events recorded yet.</ListEmpty> : (
        <ul className="divide-y">
          {securityEvents.map((event) => (
            <li key={event.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Check className="size-3.5 shrink-0 text-muted-foreground" />
                <code className="truncate font-mono text-xs">{event.action}</code>
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{event.ip ?? '—'}</span> · <LocalTime value={event.createdAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}
