// AI 원가 계산. 단가는 100만 토큰당 달러인데, 이 값은 그대로 "토큰당 마이크로달러"와 같다($1/100만 토큰 = 1µ$/토큰).
// 원장에는 정수 마이크로달러로 저장한다.
import type { ProviderUsage, UsagePart } from './types';

/** 아래 단가표를 확인한 날. 단가가 바뀌면 표와 이 날짜를 함께 고친다(출처: Anthropic 가격표). */
export const PRICES_AS_OF = '2026-10-06';

export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** 5분 보관 캐시 쓰기(입력 단가의 1.25배) */
  cacheWrite5m: number;
  /** 1시간 보관 캐시 쓰기(입력 단가의 2배) */
  cacheWrite1h: number;
  /** 프롬프트가 이 토큰 수를 넘으면 다른 단가를 쓰는 모델(Haiku 5.5) */
  longPrompt?: { over: number; input: number; output: number };
}

const price = (input: number, output: number, cacheRead: number, longPrompt?: ModelPrice['longPrompt']): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite5m: input * 1.25,
  cacheWrite1h: input * 2,
  ...(longPrompt ? { longPrompt } : {}),
});

/**
 * 모델별 단가(100만 토큰당 달러). 기본 모델과 대체 모델(fallbacks)이 답할 수 있는 모델을 넣는다.
 * Claude Haiku 5.5 의 캐시 읽기 단가는 다른 모델처럼 입력의 0.1배로 가정했다(가격표에서 확인 필요).
 */
export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': price(10, 50, 0.25),
  'claude-opus-5-5': price(4, 20, 0.2),
  'claude-opus-5': price(5, 25, 0.5),
  'claude-opus-4-8': price(5, 25, 0.5),
  'claude-sonnet-5-5': price(2, 10, 0.2),
  'claude-sonnet-5': price(2, 10, 0.2),
  'claude-haiku-5-5': price(0.1, 0.5, 0.01, { over: 100_000, input: 0.5, output: 2.5 }),
  mock: price(0, 0, 0),
};

/** 모르는 모델은 표에서 가장 비싼 값으로 계산한다(원가를 적게 잡지 않도록). */
export const UNKNOWN_PRICE: ModelPrice = (() => {
  const all = Object.values(PRICES);
  const max = (k: 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h') => Math.max(...all.map((p) => p[k]));
  return { input: max('input'), output: max('output'), cacheRead: max('cacheRead'), cacheWrite5m: max('cacheWrite5m'), cacheWrite1h: max('cacheWrite1h') };
})();

/** 모델 이름으로 단가를 찾는다. 정확히 같은 이름이 없으면 가장 긴 접두어(예: 날짜가 붙은 이름)로 찾는다. */
export function priceOf(model: string): ModelPrice | undefined {
  const exact = PRICES[model];
  if (exact) return exact;
  const key = Object.keys(PRICES)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : undefined;
}

function partCost(p: UsagePart, rate: ModelPrice): number {
  let r = rate;
  const prompt = p.inputTokens + p.cacheReadTokens + p.cacheWriteTokens;
  if (rate.longPrompt && prompt > rate.longPrompt.over) {
    // 긴 프롬프트 단가는 입력·출력만 알려져 있어, 캐시 단가도 같은 비율로 올려 잡는다(확인 필요).
    const k = rate.longPrompt.input / rate.input;
    r = { ...rate, input: rate.longPrompt.input, output: rate.longPrompt.output, cacheRead: rate.cacheRead * k, cacheWrite5m: rate.cacheWrite5m * k, cacheWrite1h: rate.cacheWrite1h * k };
  }
  const write1h = Math.min(p.cacheWrite1hTokens, p.cacheWriteTokens);
  return (
    p.inputTokens * r.input +
    (p.cacheWriteTokens - write1h) * r.cacheWrite5m +
    write1h * r.cacheWrite1h +
    p.cacheReadTokens * r.cacheRead +
    p.outputTokens * r.output
  );
}

/** 요청 한 번의 원가(정수 마이크로달러)와 단가표에 없던 모델 이름들 */
export function costOf(usage: ProviderUsage): { microUsd: number; unknownModels: string[] } {
  const unknownModels: string[] = [];
  let total = 0;
  for (const p of usage.parts) {
    const rate = priceOf(p.model);
    if (!rate && !unknownModels.includes(p.model)) unknownModels.push(p.model);
    total += partCost(p, rate ?? UNKNOWN_PRICE);
  }
  return { microUsd: Math.round(total), unknownModels };
}
