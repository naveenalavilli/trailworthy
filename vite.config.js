import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';

// The service worker is never served from its own cache.
const PUBLIC_SKIP = new Set(['sw.js']);

// Writes precache.json: everything the app needs to start with no signal, for
// the service worker to fetch at install time. Without it, the first visit's
// scripts were only cached if the page was reloaded while still online, because
// the service worker registers after they have already loaded. This includes
// the ONNX runtime's wasm, which is what lets a survey be developed offline.
function precacheManifest() {
  return {
    name: 'trailworthy-precache',
    generateBundle(_, bundle) {
      const files = new Set([
        ...Object.keys(bundle),
        ...readdirSync('public').filter((name) => !PUBLIC_SKIP.has(name))
      ]);
      const precache = [...files].filter((name) => !name.endsWith('.map')).sort();
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(precache, null, 2) });
    }
  };
}

// Served from a GitHub Pages project path in production, root in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/trailworthy/' : '/',
  plugins: [precacheManifest()],
  build: {
    target: 'es2022',
    outDir: 'dist'
  },
  worker: {
    format: 'es'
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers']
  }
}));
