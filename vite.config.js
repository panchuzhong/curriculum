import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/// <reference types="vitest/config" />
export default defineConfig({
  base: process.env.BASE || '/',
  plugins: [react()],
  test: {
    // Some service imports open the DB; tests needing files choose a temporary path.
    env: { DB_PATH: ':memory:' },
    exclude: ['tests/**', 'node_modules/**'],
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${process.env.PORT || 8443}`
    }
  },
  build: {
    outDir: 'dist'
  }
})
