import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// 개발 중에는 /api 요청을 서버(8787)로 넘긴다. 운영에서는 서버가 web/dist 를 직접 제공한다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    passWithNoTests: true,
  },
});
