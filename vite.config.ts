import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Dev only: pages opened with ?devlog (or ?fakestt) post their console here, so
// logs from the iOS simulator or a phone show up in the dev server's output.
function devLog(): Plugin {
  return {
    name: 'dev-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__devlog', (req, res) => {
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          for (const line of body.split('\n')) if (line) console.log(`[page] ${line}`)
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Use base path for GitHub Pages, fallback to root for local development
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), devLog()],
  server: {
    allowedHosts: ["erma-dogged-edmond.ngrok-free.dev"],
  },
})
