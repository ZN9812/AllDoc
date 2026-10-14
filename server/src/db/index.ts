// 서버의 SQLite 연결과 마이그레이션. 연결은 하나만 열어 저장 모듈(QuotaStore·LedgerStore·AccountStore 등)이 함께 쓴다.
// 마이그레이션은 번호 순서대로 한 번씩만 돌고, 어디까지 돌았는지는 PRAGMA user_version 에 남긴다.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * 번호 = 배열 위치 + 1. 이미 배포한 마이그레이션은 고치지 말고 뒤에 새로 붙인다.
 * 1·2번은 마이그레이션을 도입하기 전부터 있던 테이블이라, 옛 파일에서도 그대로 돌도록 IF NOT EXISTS 로 쓴다.
 */
export const MIGRATIONS: readonly string[] = [
  // 1: 사용자별 하루 AI 사용 횟수
  `CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day))`,
  // 2: AI 사용량 원장(문서 글은 담지 않는다)
  `CREATE TABLE IF NOT EXISTS ai_events (
    id INTEGER PRIMARY KEY,
    at INTEGER NOT NULL, day TEXT NOT NULL, user_id TEXT, plan_id TEXT,
    task TEXT NOT NULL, provider TEXT NOT NULL, model_requested TEXT NOT NULL, model_served TEXT, fallback INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER, output_tokens INTEGER, cache_write_tokens INTEGER, cache_read_tokens INTEGER,
    cost_micro_usd INTEGER,
    doc_chars INTEGER NOT NULL, proposals INTEGER NOT NULL, dropped INTEGER NOT NULL, ms INTEGER NOT NULL, outcome TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS ai_events_day ON ai_events (day);`,
  // 3: 사용자, 관리자 수동 요금제 부여, 관리 기록
  `CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT, name TEXT, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    role TEXT NOT NULL DEFAULT 'user',
    session_version INTEGER NOT NULL DEFAULT 1,
    terms_version TEXT, agreed_at INTEGER, age14_confirmed INTEGER,
    deleted_at INTEGER);
   CREATE INDEX users_email ON users (email);
   CREATE TABLE entitlement_overrides (
    user_id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, valid_until INTEGER, note TEXT, created_at INTEGER NOT NULL, created_by TEXT NOT NULL);
   CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT);
   CREATE INDEX ai_events_user_day ON ai_events (user_id, day);`,
];

export function migrate(db: DatabaseSync): number {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`데이터 파일이 이 서버보다 새 버전이에요(파일 ${current}, 서버 ${MIGRATIONS.length}). 서버를 최신으로 올려 주세요.`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return MIGRATIONS.length;
}

/** 데이터 파일을 열고(없으면 만들고) 마이그레이션을 끝까지 돌린다. ':memory:' 는 시험용. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db);
  return db;
}
