import { createFileRoute } from '@tanstack/react-router'
import QRCode from 'qrcode'

export const Route = createFileRoute('/api/qr/$code')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const base = process.env.APP_BASE_URL ?? 'http://localhost:3000'
        const png = await QRCode.toBuffer(`${base}/${params.code}`, {
          width: 512,
          margin: 2,
          errorCorrectionLevel: 'M',
        })
        return new Response(new Uint8Array(png), {
          headers: {
            'content-type': 'image/png',
            'cache-control': 'public, max-age=86400',
          },
        })
      },
    },
  },
})
