import type { AiMode } from '@alldoc/shared';
import type { Config } from '../config';
import { AnthropicProvider } from './anthropic';
import { MockProvider } from './mock';
import type { AiProvider } from './types';

export type Providers = Record<AiMode, AiProvider | null>;

/** 설정대로 작업별 AI 연결부를 만든다. 쓸 수 없는 작업(키 없음, off)은 null 이다. */
export function createProviders(config: Pick<Config, 'ai'>, warn: (message: string) => void = (m) => console.warn(m)): Providers {
  const out = {} as Providers;
  for (const mode of ['chat', 'format_check'] as const) {
    const s = config.ai[mode];
    if (s.provider === 'mock') out[mode] = new MockProvider();
    else if (s.provider === 'anthropic') {
      if (!s.apiKey) {
        warn(`AI(${mode}): ANTHROPIC_API_KEY 가 없어 AI 기능을 쓸 수 없어요. (데모로 보려면 AI_PROVIDER=mock)`);
        out[mode] = null;
      } else out[mode] = new AnthropicProvider(s, undefined, warn);
    } else out[mode] = null;
  }
  return out;
}
