import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: {
    port: 3000,
    // Pre-transform the app at server start. In dev, vite serves every module
    // unbundled and each route file costs ~400ms to compile on first request;
    // warming them up front keeps first page loads fast too.
    warmup: {
      clientFiles: ['./src/router.tsx', './src/routes/**/*', './src/components/**/*'],
      ssrFiles: ['./src/router.tsx', './src/routes/**/*'],
    },
  },
  plugins: [
    tsConfigPaths(),
    tailwindcss(),
    tanstackStart(),
    nitro(),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
})
