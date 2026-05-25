import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/// <reference types="vitest/config" />
export default defineConfig({
  base: process.env.BASE || '/',
  plugins: [react()],
  test: {
    exclude: ['tests/**', 'node_modules/**'],
  },
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8443'
    }
  },
  build: {
    outDir: 'dist'
  }
})
