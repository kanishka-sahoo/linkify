import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, KeyRound } from 'lucide-react'
import { getBootstrap } from '~/lib/session'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { AuthCard, AuthShell } from '~/components/auth-shell'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const { needsSetup, user } = await getBootstrap()
    if (needsSetup) throw redirect({ to: '/setup' })
    if (user) throw redirect({ to: '/dashboard' })
  },
  component: LoginPage,
})

function LoginPage() {
  const router = useRouter()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [awaitingTotp, setAwaitingTotp] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // better-auth signals a pending 2FA challenge via twoFactorRedirect
    const onSuccess = ({ data }: { data: unknown }) => {
      if ((data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
        setAwaitingTotp(true)
      } else {
        router.navigate({ to: '/dashboard' })
      }
    }
    // Usernames can't contain '@', so anything with one is an email.
    const { error } = login.includes('@')
      ? await authClient.signIn.email({ email: login.trim(), password }, { onSuccess })
      : await authClient.signIn.username({ username: login.trim(), password }, { onSuccess })
    setLoading(false)
    if (error) toast.error(error.message ?? 'Sign in failed')
  }

  async function onTotpSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await authClient.twoFactor.verifyTotp({ code: totpCode })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? 'Invalid code')
      return
    }
    router.navigate({ to: '/dashboard' })
  }

  async function onPasskey() {
    setLoading(true)
    const { error } = await authClient.signIn.passkey()
    setLoading(false)
    if (error) {
      if (error.status !== 400) toast.error(error.message ?? 'Passkey sign-in failed')
      return
    }
    router.navigate({ to: '/dashboard' })
  }

  return (
    <AuthShell>
      <AuthCard
        title={awaitingTotp ? 'Two-factor authentication' : 'Sign in'}
        description={awaitingTotp ? 'Enter the 6-digit code from your authenticator app.' : 'Welcome back. Sign in to manage your links.'}
        footer={!awaitingTotp && 'Accounts are created by an administrator.'}
      >
        {awaitingTotp ? (
          <form onSubmit={onTotpSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="totp">Authenticator code</Label>
              <Input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                className="h-11 text-center font-mono text-lg tracking-[0.4em]"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                autoFocus
                required
              />
            </div>
            <Button type="submit" className="h-10" disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </Button>
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => setAwaitingTotp(false)}>
              <ArrowLeft /> Back
            </Button>
          </form>
        ) : (
          <div className="grid gap-5">
            <form onSubmit={onPasswordSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="login">Email or username</Label>
                <Input
                  id="login"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-10"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className="h-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="h-10" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
            <Button type="button" variant="outline" className="h-10" onClick={onPasskey} disabled={loading}>
              <KeyRound /> Sign in with a passkey
            </Button>
          </div>
        )}
      </AuthCard>
    </AuthShell>
  )
}
