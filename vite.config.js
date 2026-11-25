import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Server-only variables the local /api needs (never VITE_-prefixed, so never shipped to the browser).
const SERVER_ENV_KEYS = [
  'NODE_ENV', 'FIREBASE_PROJECT_ID', 'APP_ORIGINS', 'AUTH_PEPPER',
  'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_SERVICE_ACCOUNT_BASE64', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RESEND_API_KEY', 'MAIL_FROM',
  'FIREBASE_STORAGE_BUCKET', 'FIREBASE_STORAGE_EMULATOR_HOST',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OAUTH_REDIRECT_BASE',
  'FIREBASE_HASH_SIGNER_KEY', 'FIREBASE_HASH_SALT_SEPARATOR', 'FIREBASE_HASH_ROUNDS', 'FIREBASE_HASH_MEM_COST',
]

/**
 * Dev only: serve /api/auth/* from the same router Vercel uses (server/router.ts), loaded through
 * Vite's SSR pipeline so TypeScript edits apply without a restart.
 */
function localApi(mode) {
  return {
    name: 'bullbir-local-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      for (const key of SERVER_ENV_KEYS) {
        if (env[key] !== undefined && process.env[key] === undefined) process.env[key] = env[key]
      }
      // Local development must never reach the real Firebase project: emulators only.
      const usesEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST)
      if (!usesEmulator) {
        server.config.logger.warn('[local-api] /api/auth is disabled: set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST in .env.local (see .env.example)')
      }
      // Without running emulators every request would hang until the 8 s handler timeout.
      let lastCheck = { at: 0, ok: false }
      const emulatorsUp = async () => {
        if (Date.now() - lastCheck.at < 5000) return lastCheck.ok
        const ping = (host) => fetch(`http://${host}/`, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false)
        const ok = (await ping(process.env.FIRESTORE_EMULATOR_HOST)) && (await ping(process.env.FIREBASE_AUTH_EMULATOR_HOST))
        lastCheck = { at: Date.now(), ok }
        return ok
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/auth/')) return next()
        const fail = (message) => {
          res.statusCode = 503
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: { code: 'service_unavailable', message } }))
        }
        if (!usesEmulator) return fail('Local API needs the Firebase emulators')
        if (!(await emulatorsUp())) {
          server.config.logger.warn('[local-api] Firebase emulators are not running — start them with: npm run emulators')
          return fail('Firebase emulators are not running. Start them in a second terminal: npm run emulators')
        }
        try {
          const { createHandler } = await server.ssrLoadModule('/server/router.ts')
          const { routes } = await server.ssrLoadModule('/server/routes/index.ts')
          await createHandler(routes)(req, res)
        } catch (err) {
          // Module load / env errors: print the cause in the terminal, keep the browser response JSON.
          server.config.logger.error(`[local-api] ${err instanceof Error ? err.message : String(err)}`)
          if (!res.headersSent) fail('Local API failed to start — see the dev server terminal')
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => ({
  test: {
    // Emulator suites run only via `npm run test:emulator` (vitest.emulator.config.js).
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/emulator/**'],
  },
  plugins: [
    localApi(mode),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'favicon-32.png', 'icons/apple-touch-icon.png', 'offline.html'],
      manifest: {
        name: 'BullBir',
        short_name: 'BullBir',
        description: 'Твоё личное пространство',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        theme_color: '#5b4fcf',
        background_color: '#0d0d17',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // /api/* must reach the server (e.g. OAuth callbacks), never the cached app shell.
        navigateFallbackDenylist: [/^\/offline\.html$/, /^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Firebase/Google API responses are deliberately NOT cached by the service worker:
        // they carry private user data, and Firestore already has its own offline cache
        // (which logout clears). Only static assets are cached here. Old installs may still
        // have a 'firebase-api' cache — signOutAndClear() deletes it.
        // Routes are limited to our own origin + Google Fonts: a cross-origin request handled by
        // the SW is governed by the SW's CSP `connect-src`, so third-party auth scripts
        // (apis.google.com, gstatic reCAPTCHA) must bypass the SW entirely.
        runtimeCaching: [
          {
            urlPattern: ({ request, sameOrigin }) =>
              sameOrigin && ['style', 'script', 'worker', 'font'].includes(request.destination),
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            urlPattern: ({ url }) =>
              url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          charts: ['recharts'],
          editor: ['@tiptap/react', '@tiptap/starter-kit'],
          motion: ['framer-motion'],
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
}))
