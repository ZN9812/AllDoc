import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ProviderUsage } from './ai/types';
import { LedgerStore, type AiEventInput } from './ledger';
import { formatReport, parseArgs } from './ledger-report';

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
    const ledger = new LedgerStore(file);
    expect(ledger.recordAi(event())).toBe(140_000);
    ledger.close();
    const db = new DatabaseSync(file);
    const row = db.prepare('SELECT * FROM ai_events').get() as Record<string, unknown>;
    db.close();
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
    new LedgerStore(file).close();
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
    const ledger = new LedgerStore(':memory:');
    expect(ledger.recordAi(event({ usage: undefined, outcome: 'failed', proposals: 0 }))).toBeNull();
    ledger.recordAi(event());
    const [row] = ledger.summary('2026-10-01', '2026-10-01');
    expect(row).toMatchObject({ requests: 2, ok: 1, noUsage: 1, totalMicroUsd: 140_000, p50MicroUsd: 140_000 });
    ledger.close();
  });

  it('작업·답한 모델별로 p50/p95 원가를 낸다', () => {
    const ledger = new LedgerStore(':memory:');
    // 원가 1..20 원(마이크로달러 = 출력 토큰 × 20)
    for (let i = 1; i <= 20; i++) ledger.recordAi(event({ usage: opus(0, i) }));
    ledger.recordAi(event({ task: 'format_check', usage: opus(0, 100) }));
    ledger.recordAi(event({ day: '2026-09-30', usage: opus(0, 1_000) })); // 기간 밖
    const rows = ledger.summary('2026-10-01', '2026-10-31');
    const chat = rows.find((r) => r.task === 'chat');
    expect(chat).toMatchObject({ requests: 20, p50MicroUsd: 10 * 20, p95MicroUsd: 19 * 20, totalMicroUsd: 210 * 20, avgOutputTokens: 11 });
    expect(rows.find((r) => r.task === 'format_check')?.totalMicroUsd).toBe(2_000);
    ledger.close();
  });

  it('단가표에 없는 모델은 비싼 값으로 계산하고, 모델마다 한 번만 경고한다', () => {
    const warn = vi.fn();
    const ledger = new LedgerStore(':memory:', warn);
    const tuned: ProviderUsage = { ...opus(10, 10), modelServed: 'my-tuned', parts: [{ ...opus(10, 10).parts[0]!, model: 'my-tuned' }] };
    ledger.recordAi(event({ usage: tuned }));
    ledger.recordAi(event({ usage: tuned }));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('my-tuned');
    ledger.close();
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
    const ledger = new LedgerStore(':memory:');
    ledger.recordAi(event());
    const text = formatReport(ledger.summary('2026-10-01', '2026-10-01'), '2026-10-01', '2026-10-01');
    ledger.close();
    expect(text).toContain('chat · claude-opus-5-5');
    expect(text).toContain('p50 $0.1400');
    expect(text).toContain('합계 $0.1400');
  });
});
