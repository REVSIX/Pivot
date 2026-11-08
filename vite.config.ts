import { defineConfig } from 'vite'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  root: 'client',
  plugins: [tailwind()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: { host: '127.0.0.1', fs: { strict: true } },
})
