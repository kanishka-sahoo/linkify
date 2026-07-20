import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { Toaster } from 'sonner'
import type { ReactNode } from 'react'
import appCss from '~/styles.css?url'
import { themeInitScript } from '~/components/theme-toggle'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Linkify' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
    scripts: [{ children: themeInitScript }],
  }),
  component: RootComponent,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">This link doesn't exist.</p>
    </div>
  ),
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster richColors position="bottom-right" />
        <Scripts />
      </body>
    </html>
  )
}
