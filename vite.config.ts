import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  // Single source of truth for the version is package.json; releases tag the
  // matching commit as v<version> (see README "Versioning & releases").
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    VitePWA({
      // New versions activate silently (a plain refresh always gets the
      // latest build); onNeedReload in main.tsx turns the mid-session forced
      // reload into an Update notification instead.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Bando Map',
        short_name: 'Bandos',
        description: 'Abandoned buildings in Estonia — FPV drone spots',
        theme_color: '#1a1a1a',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        // Precache only the app shell — dataset, thumbnails and tiles go into
        // named runtime caches the in-app Offline panel can show and clear.
        globPatterns: ['**/*.{js,css,html,svg}', 'pwa-*.png', 'apple-touch-icon.png'],
        globIgnores: ['thumbs/**', 'data/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/pdfs\//, /^\/data\//, /^\/thumbs\//],
        runtimeCaching: [
          {
            // Dataset: instant offline load, refreshed in the background.
            urlPattern: ({ url }) => url.pathname.startsWith('/data/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'bando-data', cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/thumbs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'bando-photos', cacheableResponse: { statuses: [200] } },
          },
          {
            // Maa-amet serves CORS-clean tiles, so cached responses keep real
            // sizes — the storage meter stays honest.
            urlPattern: ({ url }) => url.hostname === 'tiles.maaamet.ee',
            handler: 'CacheFirst',
            options: { cacheName: 'bando-tiles', cacheableResponse: { statuses: [200] } },
          },
          {
            // Glyphs for the cluster-count labels.
            urlPattern: ({ url }) => url.hostname === 'demotiles.maplibre.org',
            handler: 'CacheFirst',
            options: { cacheName: 'bando-fonts', cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
})
