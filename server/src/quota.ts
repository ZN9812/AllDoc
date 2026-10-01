// 사용자별 하루 AI 사용 횟수. SQLite(node:sqlite, Node 내장)에 저장하고, 횟수 확인과 증가를 한 문장으로 처리해 동시에 여러 번 눌러도 한도를 넘지 못하게 한다.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Quota } from '@alldoc/shared';

/** 시간대 기준의 날짜 문자열(YYYY-MM-DD). 하루가 바뀌는 시각은 이 시간대의 자정이다. */
export function dayKey(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export class QuotaStore {
  private readonly db: DatabaseSync;
  private readonly consumeStmt;
  private readonly refundStmt;
  private readonly usedStmt;
  private readonly pruneStmt;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day))',
    );
    // 한도에 닿지 않았을 때만 1 늘린다. 늘어난 행이 없으면(WHERE 가 거짓) 이미 한도다.
    this.consumeStmt = this.db.prepare(
      'INSERT INTO usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count',
    );
    this.refundStmt = this.db.prepare('UPDATE usage SET count = count - 1 WHERE user_id = ? AND day = ? AND count > 0');
    this.usedStmt = this.db.prepare('SELECT count FROM usage WHERE user_id = ? AND day = ?');
    this.pruneStmt = this.db.prepare('DELETE FROM usage WHERE day < ?');
  }

  /** 1회 사용을 예약한다. 한도를 넘으면 ok: false. */
  consume(userId: string, day: string, limit: number): { ok: boolean; used: number } {
    const row = this.consumeStmt.get(userId, day, limit) as { count: number } | undefined;
    if (row) return { ok: true, used: row.count };
    return { ok: false, used: this.used(userId, day) };
  }

  /** AI 서비스 쪽 문제로 결과를 못 받았을 때 사용 횟수를 돌려준다. */
  refund(userId: string, day: string): void {
    this.refundStmt.run(userId, day);
  }

  used(userId: string, day: string): number {
    const row = this.usedStmt.get(userId, day) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** 지난 날짜 기록을 지운다(beforeDay 보다 이른 날짜). */
  prune(beforeDay: string): void {
    this.pruneStmt.run(beforeDay);
  }

  close(): void {
    this.db.close();
  }
}

export function quotaOf(used: number, limit: number): Quota {
  return { limit, used, remaining: Math.max(0, limit - used) };
}
