import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // backend runs separately in dev; keeps `/api` paths identical to prod
    proxy: { '/api': 'http://localhost:8000' },
  },
})
