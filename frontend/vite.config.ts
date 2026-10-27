import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // The browser sees one origin, as behind nginx (spec §1.1): the dev server forwards API calls to the API.
  server: {
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
