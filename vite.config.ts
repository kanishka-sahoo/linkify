import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 3000,
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=(self)',
    },
    // Pre-transform the app at server start. In dev, vite serves every module
    // unbundled and each route file costs ~400ms to compile on first request;
    // warming them up front keeps first page loads fast too.
    warmup: {
      clientFiles: ['./src/router.tsx', './src/routes/**/*', './src/components/**/*'],
      ssrFiles: ['./src/router.tsx', './src/routes/**/*'],
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
})
