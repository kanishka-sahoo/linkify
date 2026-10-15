import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowRight, Link2 } from 'lucide-react'
import { getBootstrap } from '~/lib/session'
import { Button } from '~/components/ui/button'
import { ThemeToggle } from '~/components/theme-toggle'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { needsSetup, user } = await getBootstrap()
    if (needsSetup) throw redirect({ to: '/setup' })
    return { signedIn: Boolean(user) }
  },
  component: HomePage,
})

/** What visitors see at the root of a Linkify deployment: what this is, and the way in. */
function HomePage() {
  const { signedIn } = Route.useRouteContext()
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <main className="grid max-w-sm justify-items-center gap-6 text-center">
        <span className="grid size-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Link2 className="size-6" />
        </span>
        <div className="grid gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Linkify</h1>
          <p className="text-pretty text-muted-foreground">
            Short links on this domain are managed here. Sign in to create links and see their analytics.
          </p>
        </div>
        <Button asChild className="w-full sm:w-auto sm:px-6">
          {signedIn
            ? <Link to="/dashboard">Open dashboard <ArrowRight /></Link>
            : <Link to="/login">Sign in <ArrowRight /></Link>}
        </Button>
      </main>
    </div>
  )
}
