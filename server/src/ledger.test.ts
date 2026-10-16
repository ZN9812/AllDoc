import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderUsage } from './ai/types';
import { openDb } from './db';
import { distribution, LedgerStore, type AiEventInput, type CompileEventInput } from './ledger';
import { buildReport, formatReport, parseArgs } from './ledger-report';

const opus = (input: number, output: number): ProviderUsage => ({
  modelRequested: 'claude-opus-5-5',
  modelServed: 'claude-opus-5-5',
  fallback: false,
  parts: [{ model: 'claude-opus-5-5', inputTokens: input, outputTokens: output, cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0 }],
});

const event = (over: Partial<AiEventInput> = {}): AiEventInput => ({
  at: 1,
  day: '2026-10-01',
  userId: 'dev:테스터',
  planId: 'free',
  task: 'chat',
  provider: 'anthropic',
  modelRequested: 'claude-opus-5-5',
  usage: opus(20_000, 3_000),
  docChars: 1234,
  proposals: 2,
  dropped: 0,
  ms: 900,
  outcome: 'ok',
  ...over,
});

describe('AI 사용량 원장', () => {
  it('요청 한 번을 토큰·원가와 함께 한 줄로 남긴다', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'alldoc-ledger-')), 'alldoc.sqlite');
    const db = openDb(file);
    expect(new LedgerStore(db).recordAi(event())).toBe(140_000);
    db.close();
    const raw = new DatabaseSync(file);
    const row = raw.prepare('SELECT * FROM ai_events').get() as Record<string, unknown>;
    raw.close();
    expect(row).toMatchObject({
      day: '2026-10-01',
      user_id: 'dev:테스터',
      task: 'chat',
      model_requested: 'claude-opus-5-5',
      model_served: 'claude-opus-5-5',
      fallback: 0,
      input_tokens: 20_000,
      output_tokens: 3_000,
      cost_micro_usd: 140_000,
      doc_chars: 1234,
      outcome: 'ok',
    });
  });

  it('문서 글을 담을 칸이 없다(숫자와 모델 이름만 남긴다)', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'alldoc-ledger-')), 'alldoc.sqlite');
    openDb(file).close();
    const db = new DatabaseSync(file);
    const cols = (db.prepare('PRAGMA table_info(ai_events)').all() as Array<{ name: string }>).map((c) => c.name);
    db.close();
    expect(cols).toEqual([
      'id', 'at', 'day', 'user_id', 'plan_id', 'task', 'provider', 'model_requested', 'model_served', 'fallback',
      'input_tokens', 'output_tokens', 'cache_write_tokens', 'cache_read_tokens', 'cost_micro_usd',
      'doc_chars', 'proposals', 'dropped', 'ms', 'outcome',
    ]);
  });

  it('사용량을 받지 못한 실패는 원가를 비워 두고 요약에서 따로 센다', () => {
    const ledger = new LedgerStore(openDb(':memory:'));
    expect(ledger.recordAi(event({ usage: undefined, outcome: 'failed', proposals: 0 }))).toBeNull();
    ledger.recordAi(event());
    const [row] = ledger.summary('2026-10-01', '2026-10-01');
    expect(row).toMatchObject({ requests: 2, ok: 1, noUsage: 1, totalMicroUsd: 140_000, p50MicroUsd: 140_000 });
  });

  it('작업·답한 모델별로 p50/p95 원가를 낸다', () => {
    const ledger = new LedgerStore(openDb(':memory:'));
    // 원가 1..20 원(마이크로달러 = 출력 토큰 × 20)
    for (let i = 1; i <= 20; i++) ledger.recordAi(event({ usage: opus(0, i) }));
    ledger.recordAi(event({ task: 'format_check', usage: opus(0, 100) }));
    ledger.recordAi(event({ day: '2026-09-30', usage: opus(0, 1_000) })); // 기간 밖
    const rows = ledger.summary('2026-10-01', '2026-10-31');
    const chat = rows.find((r) => r.task === 'chat');
    expect(chat).toMatchObject({ requests: 20, p50MicroUsd: 10 * 20, p95MicroUsd: 19 * 20, totalMicroUsd: 210 * 20, avgOutputTokens: 11 });
    expect(rows.find((r) => r.task === 'format_check')?.totalMicroUsd).toBe(2_000);
  });

  it('단가표에 없는 모델은 비싼 값으로 계산하고, 모델마다 한 번만 경고한다', () => {
    const warn = vi.fn();
    const ledger = new LedgerStore(openDb(':memory:'), warn);
    const tuned: ProviderUsage = { ...opus(10, 10), modelServed: 'my-tuned', parts: [{ ...opus(10, 10).parts[0]!, model: 'my-tuned' }] };
    ledger.recordAi(event({ usage: tuned }));
    ledger.recordAi(event({ usage: tuned }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('my-tuned');
  });
});

describe('원장 보고 명령', () => {
  const now = new Date('2026-10-14T03:00:00Z');

  it('기본은 오늘까지 7일, --days·--from·--to 를 받는다', () => {
    expect(parseArgs([], now, 'Asia/Seoul')).toEqual({ from: '2026-10-08', to: '2026-10-14', json: false });
    expect(parseArgs(['--days', '1', '--json'], now, 'Asia/Seoul')).toEqual({ from: '2026-10-14', to: '2026-10-14', json: true });
    expect(parseArgs(['--from', '2026-09-01', '--to', '2026-09-30'], now, 'Asia/Seoul')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    expect(() => parseArgs(['--days', '0'], now, 'Asia/Seoul')).toThrow('--days');
    expect(() => parseArgs(['--from', '9/1'], now, 'Asia/Seoul')).toThrow('YYYY-MM-DD');
  });

  it('달러로 보여 주고 기록이 없으면 그렇게 말한다', () => {
    expect(formatReport([], '2026-10-01', '2026-10-07')).toContain('기록이 없어요');
    const ledger = new LedgerStore(openDb(':memory:'));
    ledger.recordAi(event());
    const text = formatReport(ledger.summary('2026-10-01', '2026-10-01'), '2026-10-01', '2026-10-01');
    expect(text).toContain('chat · claude-opus-5-5');
    expect(text).toContain('p50 $0.1400');
    expect(text).toContain('합계 $0.1400');
  });
});

describe('가격 근거 보고(가짜 원장 자료)', () => {
  const compile = (over: Partial<CompileEventInput> = {}): CompileEventInput => ({
    at: 1, day: '2026-10-01', userId: 'g:1', planId: 'free', engine: 'xelatex', wallMs: 1000, outcome: 'ok',
    projectBytes: 10 * 1024, files: 3, uploadedBytes: 0, pdfBytes: 50 * 1024, texlive: '2023', ...over,
  });

  /** 사용자 g:1 은 9월 30일 2회·10월 1일 3회(+실패 1), g:2 는 10월 1일 1회·10월 2일 5회, 로그인 없는 줄 1개 */
  function seeded(): LedgerStore {
    const ledger = new LedgerStore(openDb(':memory:'));
    const ai = (userId: string | null, day: string, n: number, over: Partial<AiEventInput> = {}) => {
      for (let i = 0; i < n; i++) ledger.recordAi(event({ userId, day, ...over }));
    };
    ai('g:1', '2026-09-30', 2);
    ai('g:1', '2026-10-01', 3);
    ai('g:1', '2026-10-01', 1, { outcome: 'failed', usage: undefined });
    ai('g:2', '2026-10-01', 1);
    ai('g:2', '2026-10-02', 5, { ms: 3000 });
    ai(null, '2026-10-02', 1);
    ledger.recordCompile(compile({ wallMs: 2000 }));
    ledger.recordCompile(compile({ wallMs: 1000, outcome: 'error' }));
    ledger.recordCompile(compile({ wallMs: 5, outcome: 'cached' }));
    ledger.recordCompile(compile({ wallMs: 0, outcome: 'busy' }));
    ledger.recordCompile(compile({ userId: 'g:2', day: '2026-10-02', wallMs: 60_000, outcome: 'timeout', projectBytes: 900 * 1024, pdfBytes: null }));
    ledger.recordCompile(compile({ engine: 'pdflatex', userId: 'g:3', wallMs: 800 }));
    return ledger;
  }

  it('분포는 순위 기준 p50/p95 와 최대, 묶음 수를 낸다', () => {
    expect(distribution([5, 1, 3])).toEqual({ n: 3, p50: 3, p95: 5, max: 5 });
    expect(distribution([])).toEqual({ n: 0, p50: 0, p95: 0, max: 0 });
  });

  it('AI 작업별 토큰·걸린 시간 p50/p95 를 낸다', () => {
    const [row] = seeded().summary('2026-10-01', '2026-10-31');
    // 기간 안 요청: g:1 3+실패1, g:2 1+5(3초), 익명 1 = 11건. 걸린 시간 900ms 6건·3000ms 5건
    expect(row).toMatchObject({ requests: 11, noUsage: 1, p50InputTokens: 20_000, p95OutputTokens: 3_000, p50Ms: 900, p95Ms: 3000 });
  });

  it('엔진별 컴파일 시간·크기는 일꾼이 실제로 돌린 것만 세고, 결과별 건수를 낸다', () => {
    const rows = seeded().compileSummary('2026-10-01', '2026-10-31');
    expect(rows.map((r) => r.engine)).toEqual(['pdflatex', 'xelatex']);
    expect(rows[1]).toMatchObject({
      requests: 5,
      outcomes: { ok: 1, error: 1, cached: 1, busy: 1, timeout: 1 },
      runs: 3,
      p50WallMs: 2000,
      p95WallMs: 60_000,
      maxWallMs: 60_000,
      p50ProjectBytes: 10 * 1024,
      p95ProjectBytes: 900 * 1024,
      p50PdfBytes: 50 * 1024,
    });
  });

  it('사용자당 하루·월 분포: 실패는 횟수에서 빼고, 로그인 없는 줄은 빼며, 달을 나눠 센다', () => {
    const u = seeded().userUsage('2026-09-01', '2026-10-31');
    expect(u.activeUsers).toBe(3);
    // 쓴 날별 횟수: g:1 9/30 2, 10/1 3 · g:2 10/1 1, 10/2 5
    expect(u.aiPerUserDay.requests).toEqual({ n: 4, p50: 2, p95: 5, max: 5 });
    // 쓴 달별 횟수: g:1 9월 2, 10월 3 · g:2 10월 6
    expect(u.aiPerUserMonth.requests).toEqual({ n: 3, p50: 3, p95: 6, max: 6 });
    expect(u.aiPerUserMonth.costMicroUsd.max).toBe(6 * 140_000);
    // 컴파일: g:1 10/1 2회 3초 · g:2 10/2 1회 60초 · g:3 10/1 1회 0.8초
    expect(u.compilePerUserDay.runs).toEqual({ n: 3, p50: 1, p95: 2, max: 2 });
    expect(u.compilePerUserDay.seconds).toEqual({ n: 3, p50: 3, p95: 60, max: 60 });
  });

  it('보고 글에 세 부분이 모두 나오고, JSON 에도 같은 값이 있다', () => {
    const r = buildReport(seeded(), '2026-10-01', '2026-10-31');
    expect(r.text).toContain('걸린 시간 p50 0.9초 / p95 3.0초');
    expect(r.text).toContain('xelatex: 요청 5건(busy 1, cached 1, error 1, ok 1, timeout 1) · 실제 실행 3건 · 시간 p50 2.0초 / p95 60.0초');
    expect(r.text).toContain('쓴 사용자 3명');
    expect(r.text).toContain('AI 하루 횟수 p50 3 / p95 5 / 최대 5 (3건)');
    expect(r.json.users.aiPerUserDay.requests.n).toBe(3);
    expect(r.json.compile).toHaveLength(2);
    expect(buildReport(new LedgerStore(openDb(':memory:')), '2026-10-01', '2026-10-01').text).toContain('AI 하루 횟수 기록 없음');
  });
});
