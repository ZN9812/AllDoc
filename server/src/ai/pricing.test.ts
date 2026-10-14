import { describe, expect, it } from 'vitest';
import { costOf, priceOf, PRICES, UNKNOWN_PRICE } from './pricing';
import type { UsagePart } from './types';

const part = (model: string, over: Partial<UsagePart> = {}): UsagePart => ({
  model,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  cacheReadTokens: 0,
  ...over,
});
const usage = (...parts: UsagePart[]) => ({ modelRequested: 'claude-opus-5-5', modelServed: parts.at(-1)?.model ?? 'x', fallback: false, parts });

describe('AI 원가 계산', () => {
  it('Opus 5.5: 입력 2만·출력 3천 토큰은 0.14달러(14만 마이크로달러)', () => {
    expect(costOf(usage(part('claude-opus-5-5', { inputTokens: 20_000, outputTokens: 3_000 })))).toEqual({ microUsd: 140_000, unknownModels: [] });
  });

  it('캐시 쓰기는 5분 1.25배·1시간 2배, 캐시 읽기는 모델별 단가로 계산한다', () => {
    const u = usage(part('claude-opus-5-5', { cacheWriteTokens: 1_000, cacheWrite1hTokens: 400, cacheReadTokens: 10_000 }));
    // 600×5 + 400×8 + 10000×0.2
    expect(costOf(u).microUsd).toBe(3_000 + 3_200 + 2_000);
  });

  it('대체 모델이 답하면 시도마다 그 모델의 단가로 더한다', () => {
    const u = usage(part('claude-opus-5-5', { inputTokens: 1_000, outputTokens: 10 }), part('claude-opus-4-8', { inputTokens: 1_000, outputTokens: 100 }));
    expect(costOf(u).microUsd).toBe(1_000 * 4 + 10 * 20 + 1_000 * 5 + 100 * 25);
  });

  it('Haiku 5.5 는 프롬프트가 10만 토큰을 넘으면 비싼 단가를 쓴다', () => {
    expect(costOf(usage(part('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 1_000 }))).microUsd).toBe(Math.round(100_000 * 0.1 + 1_000 * 0.5));
    expect(costOf(usage(part('claude-haiku-5-5', { inputTokens: 100_001, outputTokens: 1_000 }))).microUsd).toBe(Math.round(100_001 * 0.5 + 1_000 * 2.5));
  });

  it('날짜가 붙은 이름은 가장 긴 접두어로 찾고, 짧은 이름과 헷갈리지 않는다', () => {
    expect(priceOf('claude-opus-5-5-20261001')).toBe(PRICES['claude-opus-5-5']);
    expect(priceOf('claude-opus-5')).toBe(PRICES['claude-opus-5']);
    expect(priceOf('claude-opus-5x')).toBeUndefined();
  });

  it('모르는 모델은 가장 비싼 단가로 계산하고 이름을 알려 준다', () => {
    const r = costOf(usage(part('my-tuned', { inputTokens: 1_000, outputTokens: 1_000 })));
    expect(r.unknownModels).toEqual(['my-tuned']);
    expect(r.microUsd).toBe(1_000 * UNKNOWN_PRICE.input + 1_000 * UNKNOWN_PRICE.output);
    expect(UNKNOWN_PRICE.output).toBe(Math.max(...Object.values(PRICES).map((p) => p.output)));
  });

  it('데모 AI 와 사용량이 빈 요청은 0', () => {
    expect(costOf(usage(part('mock', { inputTokens: 5_000 }))).microUsd).toBe(0);
    expect(costOf({ modelRequested: 'mock', modelServed: 'mock', fallback: false, parts: [] })).toEqual({ microUsd: 0, unknownModels: [] });
  });
});
