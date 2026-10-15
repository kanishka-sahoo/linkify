import { Link, Outlet, createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Eye, Link2, LogOut, Settings, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getBootstrap } from '~/lib/session'
import { authClient } from '~/lib/auth-client'
import { ThemeToggle } from '~/components/theme-toggle'
import { BrandMark } from '~/components/auth-shell'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { cn } from '~/lib/utils'

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async ({ location }) => {
    const { needsSetup, user } = await getBootstrap()
    if (needsSetup) throw redirect({ to: '/setup' })
    if (!user) throw redirect({ to: '/login' })
    if (
      location.pathname !== '/dashboard/settings' &&
      (user.mustChangePassword || (user.role === 'admin' && !user.twoFactorEnabled))
    ) {
      throw redirect({ to: '/dashboard/settings' })
    }
    return { user }
  },
  component: DashboardLayout,
})

type NavTarget = '/dashboard' | '/dashboard/users' | '/dashboard/settings'

const ROLE_LABELS: Record<string, string> = { admin: 'Administrator', user: 'Member', guest: 'Guest · read-only' }

function DashboardLayout() {
  const router = useRouter()
  const { user } = Route.useRouteContext()
  const isGuest = user.role === 'guest'

  const nav: { to: NavTarget; label: string; icon?: LucideIcon; exact?: boolean }[] = [
    { to: '/dashboard', label: 'Links', icon: Link2, exact: true },
    ...(user.role === 'admin' ? [{ to: '/dashboard/users' as const, label: 'Users', icon: Users }] : []),
    ...(!isGuest ? [{ to: '/dashboard/settings' as const, label: 'Settings', icon: Settings }] : []),
  ]

  async function onSignOut() {
    await authClient.signOut()
    router.navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen bg-muted/30 dark:bg-background">
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
          <Link to="/dashboard" className="mr-4 flex items-center gap-2 rounded-md font-semibold tracking-tight">
            <BrandMark className="size-7" />
            Linkify
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
            {nav.map(({ to, label, icon: Icon, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact }}
                className="flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[status=active]:bg-accent data-[status=active]:text-foreground"
              >
                {Icon && <Icon className="size-4" />}
                {label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {isGuest && (
              <span className="mr-1 hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground sm:inline-flex">
                <Eye className="size-3.5" /> Read-only
              </span>
            )}
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                className="ml-1 grid size-8 cursor-pointer place-items-center rounded-full bg-secondary text-xs font-semibold uppercase text-secondary-foreground ring-offset-2 ring-offset-background transition hover:ring-2 hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Account menu"
              >
                {(user.name || user.email).slice(0, 1)}
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                <DropdownMenuLabel className="grid gap-0.5">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
                  <span className="mt-1 text-xs font-normal text-muted-foreground">{ROLE_LABELS[user.role] ?? user.role}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {!isGuest && (
                  <DropdownMenuItem asChild>
                    <Link to="/dashboard/settings"><Settings /> Account settings</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={onSignOut}>
                  <LogOut /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {nav.length > 1 && (
          <nav aria-label="Main" className="scrollbar-none mx-auto flex max-w-7xl gap-4 overflow-x-auto px-4 md:hidden">
            {nav.map(({ to, label, exact }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact }}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 border-transparent py-2.5 text-sm font-medium text-muted-foreground transition-colors',
                  'hover:text-foreground data-[status=active]:border-foreground data-[status=active]:text-foreground',
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>
  )
}
