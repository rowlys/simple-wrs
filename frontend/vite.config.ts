import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // WEB_PORT from the repository's .env (spec §10), the port the Compose stack's nginx is published on.
  const { WEB_PORT } = loadEnv(mode, '..', 'WEB_PORT');
  const stack = `http://localhost:${WEB_PORT || 8080}`;
  return {
    plugins: [react()],
    // The browser sees one origin, as behind nginx (spec §1.1): the dev server forwards API calls to the Compose
    // stack's nginx, the only published service (spec §11), which proxies them to the api container.
    server: { proxy: { '/api': stack, '/health': stack } },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
    },
  };
});
