import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { ArrowRight, BarChart3, CalendarClock, ShieldCheck } from 'lucide-react'
import { getBootstrap } from '~/lib/session'
import { Button } from '~/components/ui/button'
import { AuthShell, BrandMark } from '~/components/auth-shell'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { needsSetup, user } = await getBootstrap()
    if (needsSetup) throw redirect({ to: '/setup' })
    return { signedIn: Boolean(user) }
  },
  component: HomePage,
})

const FEATURES = [
  { icon: BarChart3, title: 'Click analytics', text: 'Countries, referrers, devices, and bots for every link.' },
  { icon: CalendarClock, title: 'Schedules and limits', text: 'Start and expiry times, click caps, and fallback URLs.' },
  { icon: ShieldCheck, title: 'Protection', text: 'Password-protected links and a privacy mode.' },
]

/** What visitors see at the root of a Linkify deployment: what this is, and the way in. */
function HomePage() {
  const { signedIn } = Route.useRouteContext()
  return (
    <AuthShell>
      <div className="grid w-full max-w-3xl justify-items-center gap-10 text-center motion-safe:animate-rise-in">
        <div className="grid justify-items-center gap-5">
          <BrandMark className="size-12" />
          <div className="grid gap-3">
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Short links on this domain</h1>
            <p className="mx-auto max-w-md text-pretty text-muted-foreground">
              Links here are created and managed with Linkify. Sign in to create links and see their analytics.
            </p>
          </div>
          <Button asChild size="lg" className="px-6">
            {signedIn
              ? <Link to="/dashboard">Open dashboard <ArrowRight /></Link>
              : <Link to="/login">Sign in <ArrowRight /></Link>}
          </Button>
        </div>
        <ul className="grid w-full gap-px overflow-hidden rounded-xl border bg-border text-left shadow-sm sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="grid content-start gap-2 bg-card p-5">
              <Icon className="size-4 text-muted-foreground" />
              <div className="text-sm font-medium">{title}</div>
              <p className="text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </AuthShell>
  )
}
