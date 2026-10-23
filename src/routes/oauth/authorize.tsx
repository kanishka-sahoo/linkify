import { createFileRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ArrowUpRight } from 'lucide-react'
import { approveAuthorization, getAuthorizationRequest, type AuthorizationView } from '~/lib/connected-apps'
import { API_SCOPE_DESCRIPTIONS, type ApiScope } from '~/lib/api-scopes'
import { AuthCard, AuthShell } from '~/components/auth-shell'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'

/**
 * OAuth authorization endpoint: MCP hosts such as Claude and ChatGPT send the
 * user here to sign in and approve access, then get a code back on their
 * redirect URI.
 */
export const Route = createFileRoute('/oauth/authorize')({
  validateSearch: (search: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(search).filter((e): e is [string, string] => typeof e[1] === 'string')),
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ deps, location }) => {
    const view = await getAuthorizationRequest({ data: deps.search })
    if (view.kind === 'signed-out') throw redirect({ to: '/login', search: { redirect: location.href } })
    return view
  },
  // Every visit is a new authorization request; never reuse a cached decision.
  staleTime: 0,
  gcTime: 0,
  component: AuthorizePage,
})

/** Leave the app for the client's redirect URI (https, loopback, or a native app's scheme). */
function leave(url: string) {
  window.location.assign(url)
}

function AuthorizePage() {
  const view = Route.useLoaderData()
  return (
    <AuthShell>
      {view.kind === 'consent' ? <Consent view={view} />
        : view.kind === 'redirect' ? <Redirecting url={view.url} />
          : (
            <AuthCard title="Can't connect this app" description={view.message}>
              <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>Close this window and try again from the app. If it keeps happening, remove the connector and add it again.</p>
              </div>
            </AuthCard>
          )}
    </AuthShell>
  )
}

function Redirecting({ url }: { url: string }) {
  useEffect(() => leave(url), [url])
  return (
    <AuthCard title="Returning to the app…" description="The app's request couldn't be completed.">
      <Button variant="outline" className="w-full" onClick={() => leave(url)}>Continue</Button>
    </AuthCard>
  )
}

function Consent({ view }: { view: Extract<AuthorizationView, { kind: 'consent' }> }) {
  const [scopes, setScopes] = useState<Set<ApiScope>>(new Set(view.scopes))
  const [busy, setBusy] = useState(false)

  async function approve(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const { url } = await approveAuthorization({ data: { ...view.params, scopes: [...scopes] } })
      leave(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve the app')
      setBusy(false)
    }
  }

  function deny() {
    setBusy(true)
    leave(view.denyUrl)
  }

  return (
    <AuthCard
      title={<>Connect <span className="break-words">{view.clientName}</span></>}
      description={<>This app wants to use Linkify as <span className="font-medium text-foreground">{view.account}</span>.</>}
      footer="You can disconnect it at any time in Settings → Connected apps."
    >
      <form onSubmit={approve} className="grid gap-5">
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">It will be able to</legend>
          <div className="grid gap-2.5 rounded-lg border p-3">
            {view.scopes.map((scope) => (
              <label key={scope} className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={scopes.has(scope)}
                  onChange={(e) => {
                    const next = new Set(scopes)
                    if (e.target.checked) next.add(scope); else next.delete(scope)
                    setScopes(next)
                  }}
                />
                <span className="grid gap-0.5">
                  {API_SCOPE_DESCRIPTIONS[scope]}
                  <code className="font-mono text-xs text-muted-foreground">{scope}</code>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <ArrowUpRight className="mt-px size-3.5 shrink-0" />
          <span>
            Approving sends you to <span className="font-mono font-medium text-foreground">{view.redirectHost}</span>.
            Only connect apps you trust.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" className="h-10" onClick={deny} disabled={busy}>Deny</Button>
          <Button type="submit" className="h-10" disabled={busy || scopes.size === 0}>Allow</Button>
        </div>
      </form>
    </AuthCard>
  )
}
