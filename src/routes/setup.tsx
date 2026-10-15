import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { getBootstrap } from '~/lib/session'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { AuthCard, AuthShell } from '~/components/auth-shell'

export const Route = createFileRoute('/setup')({
  beforeLoad: async () => {
    if (!(await getBootstrap()).needsSetup) throw redirect({ to: '/login' })
  },
  component: SetupPage,
})

function SetupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [setupSecret, setSetupSecret] = useState('')
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    const { error } = await authClient.signUp.email({
      name,
      email,
      password,
      fetchOptions: {
        headers: { 'x-linkify-setup-secret': setupSecret },
      },
    })
    setLoading(false)
    if (error) {
      toast.error(error.message ?? 'Sign up failed')
      return
    }
    toast.success('Account created')
    router.navigate({ to: '/dashboard' })
  }

  return (
    <AuthShell>
      <AuthCard
        title="Welcome to Linkify"
        description="Create the first administrator account. This is a one-time setup."
        footer="You can invite members and guests from the dashboard afterwards."
      >
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
            <Label htmlFor="setup-secret">Setup secret</Label>
            <Input
              id="setup-secret"
              type="password"
              value={setupSecret}
              onChange={(e) => setSetupSecret(e.target.value)}
              autoComplete="off"
              autoFocus
              required
            />
            <p className="text-xs text-muted-foreground">
              The <code className="font-mono">SETUP_SECRET</code> from the deployment environment.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" className="h-10" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" className="h-10" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              className="h-10"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">At least 12 characters.</p>
          </div>
          <Button type="submit" className="h-10" disabled={loading}>
            {loading ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </AuthCard>
    </AuthShell>
  )
}
