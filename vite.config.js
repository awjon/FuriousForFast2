import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so `npm run build` output can be dropped on any static host
  // (GitHub Pages, itch.io, S3) without rewriting asset URLs.
  base: './',
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    // three is ~530 kB minified on its own; that is expected, not a regression.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Keep three in its own chunk so editing game code doesn't bust its
        // cache. Vite 8 bundles with Rolldown, which requires the function
        // form here — the object form (`{ three: ['three'] }`) is rejected.
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          return null;
        },
      },
    },
  },
});
