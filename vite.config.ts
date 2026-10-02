import { defineConfig } from 'vite';

export default defineConfig({
  // Electron 은 file:// 로 dist/index.html 을 열므로 상대 경로
  base: './',
  server: { port: 5190 },
  build: { target: 'es2020' },
});
