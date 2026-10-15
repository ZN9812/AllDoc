// AI 사용량 원장. 요청마다 토큰과 원가를 한 줄씩 남겨 기능별 원가(p50/p95)를 계산하는 데 쓴다.
// 문서 글·지시문·응답 글은 남기지 않는다(docs/AI.md 의 약속). 남기는 것은 숫자와 모델 이름뿐이다.
import type { DatabaseSync } from 'node:sqlite';
import type { AiTask, TexEngine } from '@alldoc/shared';
import { costOf } from './ai/pricing';
import type { ProviderUsage } from './ai/types';

/** ok: 제안을 돌려줌 · refused: 모델이 거절 · failed: 실패(연결·끊김·형식) · aborted: 사용자가 취소하거나 시간 초과 */
export type AiOutcome = 'ok' | 'refused' | 'failed' | 'aborted';

export interface AiEventInput {
  at: number;
  day: string;
  /** 로그인 없이 쓰는 설치(AUTH_MODE=none)는 null */
  userId: string | null;
  /** 요청 당시의 요금제(로그인 없는 설치는 anonymous) */
  planId: string | null;
  /** 서버 안의 AI 작업(chat·format_check·tex_chat·tex_fix) */
  task: AiTask;
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

/** ok·error·timeout: 컴파일함 · too_large: 크기 상한 · busy: 대기열이 꽉 참 · cached: 이미 만든 결과를 돌려줌 · failed: 일꾼 문제 */
export type CompileOutcome = 'ok' | 'error' | 'timeout' | 'too_large' | 'busy' | 'cached' | 'failed';

export interface CompileEventInput {
  at: number;
  day: string;
  userId: string | null;
  planId: string | null;
  engine: TexEngine;
  wallMs: number;
  outcome: CompileOutcome;
  projectBytes: number;
  files: number;
  /** 이번 컴파일 전에 새로 올린 바이트(같은 파일을 다시 올리지 않는지 보려고) */
  uploadedBytes: number;
  pdfBytes: number | null;
  texlive: string | null;
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
  /** 사용량을 아는 요청의 토큰 백분위(출력에는 추론 토큰 포함) */
  p50InputTokens: number;
  p95InputTokens: number;
  p50OutputTokens: number;
  p95OutputTokens: number;
  /** 모든 요청의 걸린 시간 백분위(밀리초) */
  p50Ms: number;
  p95Ms: number;
}

/** 엔진별 컴파일 요약. 시간·크기 백분위는 일꾼이 실제로 돌린 것(ok·error·timeout)만 센다(하루 한도와 같은 기준). */
export interface CompileSummaryRow {
  engine: string;
  /** 모든 결과(캐시·대기열 꽉 참 포함) */
  requests: number;
  outcomes: Record<string, number>;
  /** 일꾼이 실제로 돌린 수 */
  runs: number;
  p50WallMs: number;
  p95WallMs: number;
  maxWallMs: number;
  p50ProjectBytes: number;
  p95ProjectBytes: number;
  p50PdfBytes: number;
}

/** 값 묶음의 분포. n 은 묶음 수(예: 쓴 사람·날 쌍의 수) */
export interface Distribution {
  n: number;
  p50: number;
  p95: number;
  max: number;
}

/**
 * 사용자당 사용량 분포. 로그인 없이 쓴 줄(user_id 없음)은 빼고, "쓴 날(달)"만 센다(안 쓴 날의 0 은 넣지 않는다).
 * AI 횟수는 하루 한도와 같은 기준(ok·refused, 실패·취소는 횟수를 돌려주므로 뺌), 원가는 모든 줄의 합이다.
 */
export interface UserUsageSummary {
  /** 기간에 AI 나 컴파일을 한 번이라도 쓴 사용자 수 */
  activeUsers: number;
  aiPerUserDay: { requests: Distribution; costMicroUsd: Distribution };
  aiPerUserMonth: { requests: Distribution; costMicroUsd: Distribution };
  compilePerUserDay: { runs: Distribution; seconds: Distribution };
  compilePerUserMonth: { runs: Distribution; seconds: Distribution };
}

/** 순위 기준 백분위(정렬된 배열) */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const sortedNums = (xs: Array<number | null>): number[] => xs.filter((x): x is number => x !== null).sort((a, b) => a - b);

export function distribution(values: number[]): Distribution {
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), max: s[s.length - 1] ?? 0 };
}

export class LedgerStore {
  private readonly insertStmt;
  private readonly userCostStmt;
  private readonly dayCostStmt;
  private readonly warned = new Set<string>();

  /** 테이블은 db/index.ts 의 마이그레이션이 만든다. */
  constructor(
    private readonly db: DatabaseSync,
    private readonly warn: (message: string) => void = (m) => console.warn(m),
  ) {
    this.insertStmt = this.db.prepare(
      `INSERT INTO ai_events (at, day, user_id, plan_id, task, provider, model_requested, model_served, fallback,
        input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_micro_usd, doc_chars, proposals, dropped, ms, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.userCostStmt = this.db.prepare('SELECT COALESCE(SUM(cost_micro_usd), 0) AS n FROM ai_events WHERE user_id = ? AND day >= ? AND day <= ?');
    this.dayCostStmt = this.db.prepare('SELECT COALESCE(SUM(cost_micro_usd), 0) AS n FROM ai_events WHERE day = ?');
  }

  /** 탈퇴: 그 사용자의 줄(AI·컴파일 원장)을 가명으로 바꾼다. 통계는 남고 신원은 사라진다. 바꾼 줄 수를 돌려준다. */
  pseudonymize(userId: string, alias: string): number {
    const ai = Number(this.db.prepare('UPDATE ai_events SET user_id = ? WHERE user_id = ?').run(alias, userId).changes);
    const compile = Number(this.db.prepare('UPDATE compile_events SET user_id = ? WHERE user_id = ?').run(alias, userId).changes);
    return ai + compile;
  }

  /** 컴파일 한 번을 남긴다. 파일 이름·내용은 남기지 않는다. */
  recordCompile(e: CompileEventInput): void {
    this.db
      .prepare(
        `INSERT INTO compile_events (at, day, user_id, plan_id, engine, wall_ms, outcome, project_bytes, files, uploaded_bytes, pdf_bytes, texlive)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(e.at, e.day, e.userId, e.planId, e.engine, e.wallMs, e.outcome, e.projectBytes, e.files, e.uploadedBytes, e.pdfBytes, e.texlive);
  }

  /** 하루 한도에 세는 컴파일의 횟수와 시간 합. 일꾼이 실제로 돌린 것(ok·error·timeout)만 세고, 크기 초과·대기열 꽉 참·캐시·일꾼 문제는 세지 않는다. */
  compileUsage(userId: string, day: string): { count: number; ms: number } {
    const r = this.db
      .prepare(
        "SELECT COUNT(*) AS count, COALESCE(SUM(wall_ms), 0) AS ms FROM compile_events WHERE user_id = ? AND day = ? AND outcome IN ('ok', 'error', 'timeout')",
      )
      .get(userId, day) as { count: number; ms: number };
    return { count: r.count, ms: r.ms };
  }

  /** 한 사용자의 기간 원가 합(마이크로달러). 월 원가 상한에 쓴다. */
  userCost(userId: string, fromDay: string, toDay: string): number {
    return (this.userCostStmt.get(userId, fromDay, toDay) as { n: number }).n;
  }

  /** 하루 전체 원가 합(마이크로달러). 전체 비용 차단기에 쓴다. */
  dayCost(day: string): number {
    return (this.dayCostStmt.get(day) as { n: number }).n;
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
      e.at, e.day, e.userId, e.planId, e.task, e.provider, e.modelRequested, u?.modelServed ?? null, u?.fallback ? 1 : 0,
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
                input_tokens AS input, output_tokens AS output, cache_read_tokens AS cacheRead,
                ms
         FROM ai_events WHERE day >= ? AND day <= ? ORDER BY task, model`,
      )
      .all(fromDay, toDay) as Array<{ task: string; model: string; outcome: string; fallback: number; cost: number | null; input: number | null; output: number | null; cacheRead: number | null; ms: number }>;
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
      const inputs = sortedNums(known.map((r) => r.input));
      const outputs = sortedNums(known.map((r) => r.output));
      const ms = sortedNums(g.map((r) => r.ms));
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
        p50InputTokens: percentile(inputs, 50),
        p95InputTokens: percentile(inputs, 95),
        p50OutputTokens: percentile(outputs, 50),
        p95OutputTokens: percentile(outputs, 95),
        p50Ms: percentile(ms, 50),
        p95Ms: percentile(ms, 95),
      };
    });
  }

  /** 기간 동안 엔진별 컴파일 요약 */
  compileSummary(fromDay: string, toDay: string): CompileSummaryRow[] {
    const rows = this.db
      .prepare('SELECT engine, outcome, wall_ms AS ms, project_bytes AS bytes, pdf_bytes AS pdf FROM compile_events WHERE day >= ? AND day <= ? ORDER BY engine')
      .all(fromDay, toDay) as Array<{ engine: string; outcome: string; ms: number; bytes: number; pdf: number | null }>;
    const groups = new Map<string, typeof rows>();
    for (const r of rows) groups.set(r.engine, [...(groups.get(r.engine) ?? []), r]);
    return [...groups.entries()].map(([engine, g]) => {
      const outcomes: Record<string, number> = {};
      for (const r of g) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
      const ran = g.filter((r) => COUNTED_COMPILE.has(r.outcome));
      const wall = sortedNums(ran.map((r) => r.ms));
      const bytes = sortedNums(ran.map((r) => r.bytes));
      const pdf = sortedNums(ran.map((r) => r.pdf));
      return {
        engine,
        requests: g.length,
        outcomes,
        runs: ran.length,
        p50WallMs: percentile(wall, 50),
        p95WallMs: percentile(wall, 95),
        maxWallMs: wall[wall.length - 1] ?? 0,
        p50ProjectBytes: percentile(bytes, 50),
        p95ProjectBytes: percentile(bytes, 95),
        p50PdfBytes: percentile(pdf, 50),
      };
    });
  }

  /** 기간 동안 사용자당 하루·월 사용량 분포(요금제 한도를 정하는 근거) */
  userUsage(fromDay: string, toDay: string): UserUsageSummary {
    const ai = this.db
      .prepare(
        `SELECT user_id AS user, day, SUM(CASE WHEN outcome IN ('ok', 'refused') THEN 1 ELSE 0 END) AS requests, COALESCE(SUM(cost_micro_usd), 0) AS cost
         FROM ai_events WHERE user_id IS NOT NULL AND day >= ? AND day <= ? GROUP BY user_id, day`,
      )
      .all(fromDay, toDay) as Array<{ user: string; day: string; requests: number; cost: number }>;
    const compile = this.db
      .prepare(
        `SELECT user_id AS user, day, COUNT(*) AS runs, COALESCE(SUM(wall_ms), 0) AS ms
         FROM compile_events WHERE user_id IS NOT NULL AND day >= ? AND day <= ? AND outcome IN ('ok', 'error', 'timeout') GROUP BY user_id, day`,
      )
      .all(fromDay, toDay) as Array<{ user: string; day: string; runs: number; ms: number }>;
    const byMonth = <T extends { user: string; day: string }>(rows: T[], fields: Array<keyof T>) => {
      const m = new Map<string, Record<string, number>>();
      for (const r of rows) {
        const k = `${r.user}\u0000${r.day.slice(0, 7)}`;
        const acc = m.get(k) ?? {};
        for (const f of fields) acc[f as string] = (acc[f as string] ?? 0) + (r[f] as unknown as number);
        m.set(k, acc);
      }
      return [...m.values()];
    };
    const aiDays = ai.filter((r) => r.requests > 0 || r.cost > 0);
    const aiMonths = byMonth(aiDays, ['requests', 'cost']);
    const compileMonths = byMonth(compile, ['runs', 'ms']);
    const sec = (ms: number) => Math.round(ms / 100) / 10;
    return {
      activeUsers: new Set([...aiDays.map((r) => r.user), ...compile.map((r) => r.user)]).size,
      aiPerUserDay: { requests: distribution(aiDays.map((r) => r.requests)), costMicroUsd: distribution(aiDays.map((r) => r.cost)) },
      aiPerUserMonth: { requests: distribution(aiMonths.map((r) => r.requests ?? 0)), costMicroUsd: distribution(aiMonths.map((r) => r.cost ?? 0)) },
      compilePerUserDay: { runs: distribution(compile.map((r) => r.runs)), seconds: distribution(compile.map((r) => sec(r.ms))) },
      compilePerUserMonth: { runs: distribution(compileMonths.map((r) => r.runs ?? 0)), seconds: distribution(compileMonths.map((r) => sec(r.ms ?? 0))) },
    };
  }
}

/** 하루 한도에 세는(일꾼이 실제로 돌린) 컴파일 결과 */
const COUNTED_COMPILE = new Set(['ok', 'error', 'timeout']);
