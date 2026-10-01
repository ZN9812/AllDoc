import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// 임시 진입점: 서버 단계에서 로그인·한도·AI 중계로 확장한다.
const app = new Hono();
app.get('/api/health', (c) => c.json({ ok: true }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`서버가 http://localhost:${info.port} 에서 실행 중입니다.`);
});
