import { createFileRoute } from '@tanstack/react-router'
import QRCode from 'qrcode'
import { and, eq } from 'drizzle-orm'
import { auth } from '~/lib/auth'
import { db } from '~/lib/db'
import { links } from '~/lib/schema'
import { ownedByClause, validateCode } from '~/lib/links'

export const Route = createFileRoute('/api/qr/$code')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response('Unauthorized', { status: 401 })
        if (session.user.mustChangePassword || (session.user.role === 'admin' && !session.user.twoFactorEnabled)) {
          return new Response('Account security setup required', { status: 403 })
        }
        let code: string
        try {
          code = validateCode(params.code)
        } catch {
          return new Response('Not found', { status: 404 })
        }
        const owned = ownedByClause(session.user)
        const [link] = await db
          .select({ id: links.id })
          .from(links)
          .where(owned ? and(eq(links.code, code), owned) : eq(links.code, code))
        if (!link) return new Response('Not found', { status: 404 })
        const base = process.env.APP_BASE_URL ?? 'http://localhost:3000'
        const png = await QRCode.toBuffer(`${base}/${code}`, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
        })
        return new Response(new Uint8Array(png), {
          headers: {
            'content-type': 'image/png',
            'cache-control': 'private, max-age=3600',
            'x-content-type-options': 'nosniff',
          },
        })
      },
    },
  },
})
