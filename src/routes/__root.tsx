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
    links: [
      { rel: 'stylesheet', href: appCss },
      // Inline icon so browsers don't make a wasted /favicon.ico request.
      {
        rel: 'icon',
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237c3aed' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 17H7A5 5 0 0 1 7 7h2'/%3E%3Cpath d='M15 7h2a5 5 0 1 1 0 10h-2'/%3E%3Cline x1='8' y1='12' x2='16' y2='12'/%3E%3C/svg%3E",
      },
    ],
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
