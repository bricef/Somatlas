import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/Somatlas/) and
  // later at the root of somatlas.org.
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
