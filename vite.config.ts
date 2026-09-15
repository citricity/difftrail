// `vitest/config` re-exports Vite's `defineConfig` widened with the `test`
// block, which keeps one config file instead of two.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vite is configured for the Tauri shell: a fixed dev port that
 * `tauri.conf.json` points at, and a build target matching the WebView that
 * ships with each desktop platform.
 */
export default defineConfig({
  plugins: [react()],

  // Tauri owns the terminal output; don't let Vite clear its messages.
  clearScreen: false,

  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // The Rust side has its own watcher.
      ignored: ['**/src-tauri/**'],
    },
  },

  envPrefix: ['VITE_', 'TAURI_'],

  build: {
    // macOS and Linux ship WKWebView/WebKitGTK; Windows ships WebView2.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari15',
    minify: process.env.TAURI_ENV_DEBUG === 'true' ? false : 'esbuild',
    sourcemap: process.env.TAURI_ENV_DEBUG === 'true',
  },

  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
