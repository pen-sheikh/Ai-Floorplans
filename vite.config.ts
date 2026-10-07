/// <reference types="vitest/config" />
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serve OCR locally (no CDN, works offline): copy the tesseract.js worker, the LSTM WASM cores
 * and the English model from node_modules into public/ocr (gitignored) before dev/build.
 */
function localOcrAssets(): Plugin {
  const files: [string, string][] = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    [
      'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
      'tesseract-core-relaxedsimd-lstm.wasm.js',
    ],
    ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
  ];
  return {
    name: 'local-ocr-assets',
    buildStart() {
      for (const [from, to] of files) {
        const src = resolve(import.meta.dirname, from);
        const dst = resolve(import.meta.dirname, 'public/ocr', to);
        if (!existsSync(src)) throw new Error(`OCR asset missing: ${from} (run npm install)`);
        if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue;
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), localOcrAssets()],
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/@react-three/')) return 'r3f';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Image-processing tests are CPU-bound and run in parallel workers: allow headroom.
    testTimeout: 30_000,
  },
});
