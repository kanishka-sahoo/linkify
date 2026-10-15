import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { AlertTriangle, SearchX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'

function StatusPanel({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="grid justify-items-center gap-4 rounded-xl border bg-card px-6 py-20 text-center shadow-sm">
      <span className="grid size-11 place-items-center rounded-xl border bg-muted/50 text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      </div>
      <div className="flex gap-2">
        {children}
        <Button variant="outline" asChild>
          <Link to="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  )
}

export function NotFound({ text = "This page doesn't exist." }: { text?: string }) {
  return <StatusPanel icon={SearchX} title="Not found" text={text} />
}

export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <StatusPanel icon={AlertTriangle} title="Something went wrong" text="We couldn't load this page. Try again in a moment.">
      <Button onClick={() => { reset(); router.invalidate() }}>Try again</Button>
    </StatusPanel>
  )
}
