import { createFileRoute, redirect } from '@tanstack/react-router'
import { getBootstrap } from '~/lib/session'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { needsSetup, user } = await getBootstrap()
    if (needsSetup) throw redirect({ to: '/setup' })
    throw redirect({ to: user ? '/dashboard' : '/login' })
  },
})
