import { createFileRoute, redirect } from '@tanstack/react-router'
import { getSession, needsSetup } from '~/lib/session'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    if (await needsSetup()) throw redirect({ to: '/setup' })
    const session = await getSession()
    throw redirect({ to: session ? '/dashboard' : '/login' })
  },
})
