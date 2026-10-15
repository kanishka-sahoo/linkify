import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { BarChart3, Copy, ExternalLink, QrCode } from 'lucide-react'
import type { SafeLink } from '~/lib/link-domain'
import { Button } from '~/components/ui/button'
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '~/components/ui/sheet'
import { LocalTime, RelativeTime } from '~/components/local-time'
import { cn } from '~/lib/utils'
import { ClickUsage, LINK_STATES, StatusBadge, displayUrl, linkState } from '~/components/link-status'

export interface LinkOwner {
  name: string
  email: string
  deactivatedAt: Date | null
}

function DetailRow({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 @sm:grid-cols-[8rem_1fr] @sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">
        {children}
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="@container">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      <dl className="divide-y">{children}</dl>
    </section>
  )
}

const notSet = <span className="text-muted-foreground">Not set</span>

function Timestamp({ value }: { value: Date | string }) {
  return (
    <>
      <LocalTime value={value} />
      <span className="text-muted-foreground"> · <RelativeTime value={value} /></span>
    </>
  )
}

/**
 * Every lifecycle, protection, and ownership setting of a link, read-only.
 * This is the only place a guest can see how a link is configured.
 */
export function LinkSettings({ link, owner, className }: { link: SafeLink; owner?: LinkOwner; className?: string }) {
  const state = linkState(link)
  return (
    <div className={cn('grid gap-6', className)}>
      <Section title="Availability">
        <DetailRow label="Status" hint={LINK_STATES[state].summary}>
          <StatusBadge state={state} />
        </DetailRow>
        <DetailRow label="Starts" hint={link.startsAt ? undefined : 'Live as soon as it was created'}>
          {link.startsAt ? <Timestamp value={link.startsAt} /> : notSet}
        </DetailRow>
        <DetailRow label="Expires" hint={link.expiresAt ? undefined : 'Never expires'}>
          {link.expiresAt ? <Timestamp value={link.expiresAt} /> : notSet}
        </DetailRow>
        <DetailRow label="Click limit" hint={link.maxClicks ? 'Only redirected visits count toward the limit' : 'Unlimited clicks'}>
          {link.maxClicks ? <ClickUsage count={link.clickCount} max={link.maxClicks} className="w-full max-w-56" /> : notSet}
        </DetailRow>
        <DetailRow
          label="When inactive"
          hint={link.expiredRedirectUrl ? 'Visitors go here while the link is paused, scheduled, expired, or at its limit' : undefined}
        >
          {link.expiredRedirectUrl ? (
            <a href={link.expiredRedirectUrl} target="_blank" rel="noreferrer" className="break-all hover:underline">
              {displayUrl(link.expiredRedirectUrl)}
            </a>
          ) : (
            <span className="text-muted-foreground">Shows an “unavailable” page</span>
          )}
        </DetailRow>
      </Section>

      <Section title="Protection">
        <DetailRow label="Password">
          {link.passwordProtected ? 'Required before redirecting' : <span className="text-muted-foreground">None</span>}
        </DetailRow>
        <DetailRow label="Privacy mode" hint={link.privacyEnabled ? 'Visitor IP, city, and user agent aren’t stored' : undefined}>
          {link.privacyEnabled ? 'On' : <span className="text-muted-foreground">Off</span>}
        </DetailRow>
      </Section>

      <Section title="Details">
        <DetailRow label="Tags">
          {link.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {link.tags.map((t) => (
                <span key={t} className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium">{t}</span>
              ))}
            </div>
          ) : <span className="text-muted-foreground">None</span>}
        </DetailRow>
        {owner && (
          <DetailRow label="Owner" hint={owner.deactivatedAt ? 'Account deactivated' : undefined}>
            <span className="break-all">{owner.name} <span className="text-muted-foreground">({owner.email})</span></span>
          </DetailRow>
        )}
        <DetailRow label="Created"><Timestamp value={link.createdAt} /></DetailRow>
        <DetailRow label="Last updated"><Timestamp value={link.updatedAt} /></DetailRow>
      </Section>
    </div>
  )
}

/** The read-only panel guests get when they open a link; editors get `LinkEditorSheet`. */
export function LinkDetailsSheet({ link, ownerOf, onClose, onShowQr }: {
  link: SafeLink | null
  ownerOf: (link: SafeLink) => LinkOwner | undefined
  onClose: () => void
  onShowQr: (link: SafeLink) => void
}) {
  // Keep showing the last link while the sheet animates closed.
  const [lastLink, setLastLink] = useState(link)
  if (link && link !== lastLink) setLastLink(link)
  const shown = link ?? lastLink

  return (
    <Sheet open={Boolean(link)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {shown && (
          <>
            <SheetHeader>
              <div className="flex min-w-0 items-center gap-2">
                <SheetTitle className="truncate font-mono">/{shown.code}</SheetTitle>
                <StatusBadge state={linkState(shown)} />
              </div>
              <SheetDescription asChild>
                <div className="grid gap-2">
                  {shown.title && <span className="text-foreground">{shown.title}</span>}
                  <a
                    href={shown.url} target="_blank" rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground hover:underline"
                  >
                    <span className="truncate">{displayUrl(shown.url)}</span>
                    <ExternalLink className="size-3.5 shrink-0" />
                  </a>
                </div>
              </SheetDescription>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  variant="outline" size="sm"
                  onClick={async () => {
                    await navigator.clipboard.writeText(`${window.location.origin}/${shown.code}`)
                    toast.success('Short link copied')
                  }}
                >
                  <Copy /> Copy link
                </Button>
                <Button variant="outline" size="sm" onClick={() => onShowQr(shown)}>
                  <QrCode /> QR code
                </Button>
              </div>
            </SheetHeader>
            <SheetBody>
              <LinkSettings link={shown} owner={ownerOf(shown)} />
            </SheetBody>
            <SheetFooter>
              <Button asChild>
                <Link to="/dashboard/links/$code" params={{ code: shown.code }}>
                  <BarChart3 /> View analytics
                </Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
