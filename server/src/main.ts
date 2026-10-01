import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { createApp } from './app';
import { createProviders } from './ai/providers';
import { ConfigError, loadConfig } from './config';
import { dayKey, QuotaStore } from './quota';

let config;
try {
  config = loadConfig();
} catch (e) {
  if (e instanceof ConfigError) {
    console.error('설정에 문제가 있어 서버를 시작하지 못했어요:');
    for (const p of e.problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  throw e;
}

const quota = new QuotaStore(join(config.dataDir, 'alldoc.sqlite'));
const providers = createProviders(config);
const app = createApp({ config, quota, providers });

// 지난 사용 기록은 2주 뒤에 지운다(하루 한도 계산에는 오늘 기록만 필요하다).
const prune = () => {
  const cutoff = dayKey(new Date(Date.now() - 14 * 86_400_000), config.timezone);
  quota.prune(cutoff);
};
prune();
const pruneTimer = setInterval(prune, 6 * 3_600_000);
pruneTimer.unref();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`서버가 ${config.publicUrl} (포트 ${info.port})에서 실행 중입니다.`);
  console.log(`로그인 방식: ${config.authMode} · 하루 AI 한도: ${config.authMode === 'none' ? '없음' : `${config.dailyLimit}회`} (${config.timezone})`);
  for (const mode of ['chat', 'format_check'] as const) {
    const p = providers[mode];
    const s = config.ai[mode];
    console.log(`AI(${mode}): ${p ? `${p.id}${p.demo ? ' [데모]' : ` · ${s.model}`}` : '연결 안 됨'}`);
  }
});

function shutdown(signal: string): void {
  console.log(`${signal} 신호를 받아 종료합니다.`);
  server.close(() => {
    quota.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
