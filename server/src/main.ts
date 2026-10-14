import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { createApp } from './app';
import { createProviders } from './ai/providers';
import { ConfigError, loadConfig } from './config';
import { loadDotEnv } from './dotenv';
import { AccountStore } from './auth/accounts';
import { openDb } from './db';
import { LedgerStore } from './ledger';
import { dayKey, QuotaStore } from './quota';

// 설정을 읽기 전에 .env 를 환경 변수로 읽는다(개발·시험용. 운영에서는 읽지 않는다).
const dotenvFile = loadDotEnv();
if (dotenvFile) console.log(`.env 를 읽었어요: ${dotenvFile}`);

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

// 데이터 파일 하나(SQLite)를 열고 마이그레이션을 돌린 뒤 저장 모듈들이 같은 연결을 쓴다.
const db = openDb(join(config.dataDir, 'alldoc.sqlite'));
const quota = new QuotaStore(db);
const accounts = new AccountStore(db);
// AI 사용량 원장. 원가 집계에 쓰므로 지우지 않는다(보고: server/dist/ledger-report.js).
const ledger = new LedgerStore(db);
const providers = createProviders(config);
const app = createApp({ config, quota, accounts, providers, ledger });

// 지난 사용 기록은 62일 뒤에 지운다(요금제의 월 한도를 계산하려면 이번 달 기록이 있어야 한다).
const prune = () => {
  const cutoff = dayKey(new Date(Date.now() - 62 * 86_400_000), config.timezone);
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
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
