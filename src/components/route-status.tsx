import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { Button } from '~/components/ui/button'

function StatusPanel({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{text}</p>
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
  return <StatusPanel title="Not found" text={text} />
}

export function RouteError({ reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <StatusPanel title="Something went wrong" text="We couldn't load this page. Try again in a moment.">
      <Button onClick={() => { reset(); router.invalidate() }}>Try again</Button>
    </StatusPanel>
  )
}
