import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Critter Corner',
        short_name: 'Critters',
        description: 'Look after an axolotl and an ant colony.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#12202b',
        theme_color: '#12202b',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
