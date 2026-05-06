import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: process.env.BASE || '/',
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8443'
    }
  },
  build: {
    outDir: 'dist'
  }
})
