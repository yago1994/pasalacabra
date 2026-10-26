import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The CSP in index.html lists every host the page may connect to. Hosts that
// depend on the build are added here instead of hard-coded:
//  - the optional off-Cloudflare token endpoint (VITE_SPEECH_TOKEN_FALLBACK_URL);
//  - ngrok, for the live log relay (src/devLog.ts), in staging and dev only.
function cspConnectExtras(): Plugin {
  return {
    name: 'csp-connect-extras',
    transformIndexHtml(html, ctx) {
      const extras: string[] = []
      const fallback = process.env.VITE_SPEECH_TOKEN_FALLBACK_URL
      if (fallback) {
        try {
          extras.push(new URL(fallback).origin)
        } catch {
          // not a URL: leave the CSP alone
        }
      }
      if (ctx.server || process.env.VITE_DEFAULT_ENV === 'staging') {
        extras.push('https://*.ngrok-free.dev', 'https://*.ngrok-free.app')
      }
      if (!extras.length) return html
      return html.replace("connect-src 'self'", `connect-src 'self' ${extras.join(' ')}`)
    },
  }
}

// Dev only: pages opened with ?devlog (or ?fakestt) post their console here, so
// logs from the iOS simulator or a phone show up in the dev server's output.
// Through ngrok, the staging site can post here too (src/devLog.ts).
function devLog(): Plugin {
  return {
    name: 'dev-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__devlog', (req, res) => {
        // The staging site posts here through ngrok (cross-origin).
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ngrok-skip-browser-warning')
        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
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
  plugins: [react(), devLog(), cspConnectExtras()],
  server: {
    allowedHosts: ["erma-dogged-edmond.ngrok-free.dev"],
  },
})
