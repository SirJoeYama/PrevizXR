import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages serves the site from /<repo>/, so production builds use that base.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/PrevizXR/' : '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true },
  // three.js alone is ~650 kB minified; that's expected for this app.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1200 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
}));
