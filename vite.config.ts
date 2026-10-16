import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages serves the site from /<repo>/, so production builds use that base. `vite preview` serves
// that build, so it needs the same base (its command is 'serve', like the dev server).
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/PrevizXR/' : '/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { host: true },
  // three.js alone is ~650 kB minified; that's expected for this app. It gets its own chunk so browsers
  // keep it cached across deploys that only change app code.
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]/ }] } },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'], fsModuleCache: true },
}));
