// AI 사용량 원장. 요청마다 토큰과 원가를 한 줄씩 남겨 기능별 원가(p50/p95)를 계산하는 데 쓴다.
// 문서 글·지시문·응답 글은 남기지 않는다(docs/AI.md 의 약속). 남기는 것은 숫자와 모델 이름뿐이다.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AiMode } from '@alldoc/shared';
import { costOf } from './ai/pricing';
import type { ProviderUsage } from './ai/types';

/** ok: 제안을 돌려줌 · refused: 모델이 거절 · failed: 실패(연결·끊김·형식) · aborted: 사용자가 취소하거나 시간 초과 */
export type AiOutcome = 'ok' | 'refused' | 'failed' | 'aborted';

export interface AiEventInput {
  at: number;
  day: string;
  /** 로그인 없이 쓰는 설치(AUTH_MODE=none)는 null */
  userId: string | null;
  task: AiMode;
  provider: string;
  /** 사용량을 받지 못한 실패에서도 어떤 모델에 보냈는지 남긴다 */
  modelRequested: string;
  usage: ProviderUsage | undefined;
  docChars: number;
  proposals: number;
  dropped: number;
  ms: number;
  outcome: AiOutcome;
}

export interface CostSummaryRow {
  task: string;
  model: string;
  requests: number;
  ok: number;
  /** 사용량을 받지 못해 원가를 모르는 요청 수(연결 실패 등) */
  noUsage: number;
  fallbacks: number;
  totalMicroUsd: number;
  p50MicroUsd: number;
  p95MicroUsd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgCacheReadTokens: number;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS ai_events (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL, day TEXT NOT NULL, user_id TEXT, plan_id TEXT,
  task TEXT NOT NULL, provider TEXT NOT NULL, model_requested TEXT NOT NULL, model_served TEXT, fallback INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER, output_tokens INTEGER, cache_write_tokens INTEGER, cache_read_tokens INTEGER,
  cost_micro_usd INTEGER,
  doc_chars INTEGER NOT NULL, proposals INTEGER NOT NULL, dropped INTEGER NOT NULL, ms INTEGER NOT NULL, outcome TEXT NOT NULL)`;

/** 순위 기준 백분위(정렬된 배열) */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

export class LedgerStore {
  private readonly db: DatabaseSync;
  private readonly insertStmt;
  private readonly warned = new Set<string>();

  constructor(
    path: string,
    private readonly warn: (message: string) => void = (m) => console.warn(m),
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec(SCHEMA);
    this.db.exec('CREATE INDEX IF NOT EXISTS ai_events_day ON ai_events (day)');
    this.insertStmt = this.db.prepare(
      `INSERT INTO ai_events (at, day, user_id, task, provider, model_requested, model_served, fallback,
        input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_micro_usd, doc_chars, proposals, dropped, ms, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  /** 한 줄을 남기고 원가(마이크로달러, 사용량을 모르면 null)를 돌려준다. 단가표에 없는 모델은 한 번만 경고한다. */
  recordAi(e: AiEventInput): number | null {
    let cost: number | null = null;
    const sum = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    if (e.usage) {
      const c = costOf(e.usage);
      cost = c.microUsd;
      for (const m of c.unknownModels) {
        if (this.warned.has(m)) continue;
        this.warned.add(m);
        this.warn(`AI 원장: 단가표에 없는 모델(${m})이라 가장 비싼 단가로 계산했어요. server/src/ai/pricing.ts 에 단가를 넣어 주세요.`);
      }
      for (const p of e.usage.parts) {
        sum.input += p.inputTokens;
        sum.output += p.outputTokens;
        sum.cacheWrite += p.cacheWriteTokens;
        sum.cacheRead += p.cacheReadTokens;
      }
    }
    const u = e.usage;
    this.insertStmt.run(
      e.at, e.day, e.userId, e.task, e.provider, e.modelRequested, u?.modelServed ?? null, u?.fallback ? 1 : 0,
      u ? sum.input : null, u ? sum.output : null, u ? sum.cacheWrite : null, u ? sum.cacheRead : null, cost,
      e.docChars, e.proposals, e.dropped, e.ms, e.outcome,
    );
    return cost;
  }

  /** 기간(fromDay 이상 toDay 이하, YYYY-MM-DD) 동안 작업·답한 모델별 원가 요약 */
  summary(fromDay: string, toDay: string): CostSummaryRow[] {
    const rows = this.db
      .prepare(
        `SELECT task, COALESCE(model_served, model_requested) AS model, outcome, fallback, cost_micro_usd AS cost,
                input_tokens AS input, output_tokens AS output, cache_read_tokens AS cacheRead
         FROM ai_events WHERE day >= ? AND day <= ? ORDER BY task, model`,
      )
      .all(fromDay, toDay) as Array<{ task: string; model: string; outcome: string; fallback: number; cost: number | null; input: number | null; output: number | null; cacheRead: number | null }>;
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.task}\u0000${r.model}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.values()].map((g) => {
      const known = g.filter((r) => r.cost !== null);
      const costs = known.map((r) => r.cost as number).sort((a, b) => a - b);
      const avg = (f: (r: (typeof g)[number]) => number | null) => (known.length ? Math.round(known.reduce((n, r) => n + (f(r) ?? 0), 0) / known.length) : 0);
      const first = g[0] as (typeof g)[number];
      return {
        task: first.task,
        model: first.model,
        requests: g.length,
        ok: g.filter((r) => r.outcome === 'ok').length,
        noUsage: g.length - known.length,
        fallbacks: g.filter((r) => r.fallback === 1).length,
        totalMicroUsd: costs.reduce((n, c) => n + c, 0),
        p50MicroUsd: percentile(costs, 50),
        p95MicroUsd: percentile(costs, 95),
        avgInputTokens: avg((r) => r.input),
        avgOutputTokens: avg((r) => r.output),
        avgCacheReadTokens: avg((r) => r.cacheRead),
      };
    });
  }

  close(): void {
    this.db.close();
  }
}
