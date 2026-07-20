import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Link2, Settings, LogOut, Users } from 'lucide-react'
import { getBootstrap } from '~/lib/session'
import { authClient } from '~/lib/auth-client'
import { Button } from '~/components/ui/button'
import { ThemeToggle } from '~/components/theme-toggle'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const { needsSetup, user } = await getBootstrap()
    if (needsSetup) throw redirect({ to: '/setup' })
    if (!user) throw redirect({ to: '/login' })
    return { user }
  },
  component: DashboardLayout,
})

function DashboardLayout() {
  const router = useRouter()
  const { user } = Route.useRouteContext()

  async function onSignOut() {
    await authClient.signOut()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold">
            <Link2 className="h-5 w-5" /> Linkify
          </Link>
          <nav className="flex flex-1 items-center gap-4 text-sm">
            <Link
              to="/dashboard"
              activeOptions={{ exact: true }}
              activeProps={{ className: 'text-foreground font-medium' }}
              inactiveProps={{ className: 'text-muted-foreground hover:text-foreground' }}
            >
              Links
            </Link>
            {user.role === 'admin' && (
              <Link
                to="/dashboard/users"
                activeProps={{ className: 'text-foreground font-medium' }}
                inactiveProps={{ className: 'text-muted-foreground hover:text-foreground' }}
              >
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" /> Users
                </span>
              </Link>
            )}
            <Link
              to="/dashboard/settings"
              activeProps={{ className: 'text-foreground font-medium' }}
              inactiveProps={{ className: 'text-muted-foreground hover:text-foreground' }}
            >
              <span className="flex items-center gap-1">
                <Settings className="h-3.5 w-3.5" /> Settings
              </span>
            </Link>
          </nav>
          <span className="hidden text-sm text-muted-foreground sm:block">{user.email}</span>
          <ThemeToggle />
          <Button variant="ghost" size="icon" onClick={onSignOut} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl p-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
