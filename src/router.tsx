import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    // Cache loader data briefly: navigating between pages doesn't refetch.
    // Every mutation in the app calls router.invalidate(), which bypasses this.
    defaultStaleTime: 30_000,
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
