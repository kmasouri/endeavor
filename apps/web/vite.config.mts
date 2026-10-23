import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The web interface. `npm run build` puts it in apps/web/dist, and the API serves it at /app/.
// `npm run dev:web` serves it with live reload and sends API calls to the server on port 3000.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/app/',
  build: {
    outDir: fileURLToPath(new URL('dist', import.meta.url)),
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      // Everything outside /app/ is the API.
      '^/(?!app/).*': 'http://127.0.0.1:3000'
    }
  }
});
