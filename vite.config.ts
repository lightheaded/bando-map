import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new version waits until the user taps the in-app Update
      // button — no surprise mid-session reloads.
      registerType: 'prompt',
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
