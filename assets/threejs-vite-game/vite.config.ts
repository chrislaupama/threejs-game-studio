import { defineConfig } from 'vite';

const port = Number(process.env.THREE_GAME_PORT ?? '5188');
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('THREE_GAME_PORT must be an integer from 1 through 65535.');
}

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port,
    strictPort: true,
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
