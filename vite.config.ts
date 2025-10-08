import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'OptiPath',
        short_name: 'OptiPath',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#317EFB',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],

  // Only proxy /api in development (so Vite -> local dev server at :5175)
  server: {
    proxy: mode === 'development'
      ? {
          '/api': {
            target: 'http://localhost:5175',
            changeOrigin: true,
            secure: false
          }
        }
      : {}
  }
}));
