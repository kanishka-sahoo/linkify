import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { getBootstrap } from '~/lib/session'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '~/components/ui/card'

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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [awaitingTotp, setAwaitingTotp] = useState(false)
  const [loading, setLoading] = useState(false)

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await authClient.signIn.email(
      { email, password },
      {
        onSuccess: (ctx) => {
          // better-auth signals a pending 2FA challenge via twoFactorRedirect
          if ((ctx.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect) {
            setAwaitingTotp(true)
          } else {
            router.navigate({ to: '/dashboard' })
          }
        },
      },
    )
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Linkify</CardTitle>
          <CardDescription>
            {awaitingTotp ? 'Enter the 6-digit code from your authenticator app.' : 'Sign in to your dashboard.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {awaitingTotp ? (
            <form onSubmit={onTotpSubmit} className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="totp">Authenticator code</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <Button type="submit" disabled={loading}>
                {loading ? 'Verifying…' : 'Verify'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAwaitingTotp(false)}>
                Back
              </Button>
            </form>
          ) : (
            <>
              <form onSubmit={onPasswordSubmit} className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button type="button" variant="outline" onClick={onPasskey} disabled={loading}>
                <KeyRound /> Sign in with a passkey
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
