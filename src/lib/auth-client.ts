import { createAuthClient } from 'better-auth/react'
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'
import type { auth } from './auth'

export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient(), inferAdditionalFields<typeof auth>()],
})

export const { signIn, signUp, signOut, useSession } = authClient
