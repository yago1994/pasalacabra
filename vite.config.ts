import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Use base path for GitHub Pages, fallback to root for local development
  base: process.env.VITE_BASE_PATH || "/pasalacabra/",
  plugins: [react()],
  server: {
    allowedHosts: ["erma-dogged-edmond.ngrok-free.dev"],
  },
})
