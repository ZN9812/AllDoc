import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { AiTaskSettings } from '../config';
import { buildMessages } from './prompt';
import { AiOutputSchema, type AiOutput } from './schema';
import { ProviderFailedError, ProviderRefusedError, type AiProvider, type ProposeInput, type ProviderResult, type ProviderUsage, type UsagePart } from './types';

/** 모델이 정책상 거절하면 서버 쪽에서 대체 모델로 다시 시도하게 하는 Anthropic 베타 기능 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** 시험에서 바꿔 끼울 수 있게, 쓰는 부분만 좁혀 둔다. */
export interface AnthropicLike {
  messages: { parse(params: any, options?: any): PromiseLike<ParsedMessage> };
  beta: { messages: { parse(params: any, options?: any): PromiseLike<ParsedMessage> } };
}

interface ParsedMessage {
  stop_reason: string | null;
  parsed_output: AiOutput | null;
  content?: unknown;
  model?: string;
  usage?: RawUsage;
}

/** 응답의 usage 중 원가 계산에 쓰는 칸만. 대체 모델이 답하면 맨 위 값은 마지막 시도만 담으므로 iterations 를 쓴다. */
interface RawUsageEntry {
  type?: string;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: { ephemeral_1h_input_tokens?: number | null } | null;
}
interface RawUsage extends RawUsageEntry {
  iterations?: RawUsageEntry[] | null;
}

/**
 * 응답에서 사용량을 뽑는다. iterations 에 시도별 값(message·fallback_message)이 있으면 그것을 모두 더하고,
 * 없으면 맨 위 값을 쓴다. 응답에 usage 가 없으면 undefined.
 */
export function usageOf(message: Pick<ParsedMessage, 'model' | 'usage'>, modelRequested: string): ProviderUsage | undefined {
  const u = message.usage;
  if (!u) return undefined;
  const modelServed = message.model ?? modelRequested;
  const tries = (u.iterations ?? []).filter((e) => e.type === 'message' || e.type === 'fallback_message');
  const n = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const part = (e: RawUsageEntry): UsagePart => ({
    model: e.model ?? modelServed,
    inputTokens: n(e.input_tokens),
    outputTokens: n(e.output_tokens),
    cacheWriteTokens: n(e.cache_creation_input_tokens),
    cacheWrite1hTokens: n(e.cache_creation?.ephemeral_1h_input_tokens),
    cacheReadTokens: n(e.cache_read_input_tokens),
  });
  return {
    modelRequested,
    modelServed,
    fallback: tries.some((e) => e.type === 'fallback_message'),
    parts: tries.length > 0 ? tries.map(part) : [part({ ...u, model: modelServed })],
  };
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.APIError) return `${e.status ?? '?'} ${e.name}: ${e.message}`.slice(0, 500);
  return e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 500) : String(e).slice(0, 500);
}

/** 연결 오류를 사용자에게 보여줄 문장으로 바꾼다(원문은 서버 기록에만 남긴다). */
export function mapAnthropicError(e: unknown): Error {
  if (e instanceof ProviderRefusedError || e instanceof ProviderFailedError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return new ProviderFailedError('AI 서비스 인증에 문제가 있어요. 운영자에게 알려 주세요.', e);
  }
  if (e instanceof Anthropic.RateLimitError) return new ProviderFailedError('AI 서비스가 지금 혼잡해요. 잠시 뒤에 다시 시도해 주세요.', e);
  if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError || e instanceof Anthropic.UnprocessableEntityError) {
    return new ProviderFailedError('AI 서비스가 이 요청을 받아들이지 않았어요. 문서를 줄이거나 운영자에게 알려 주세요.', e);
  }
  if (e instanceof Anthropic.APIConnectionError) return new ProviderFailedError('AI 서비스에 연결하지 못했어요. 잠시 뒤에 다시 시도해 주세요.', e);
  if (e instanceof Anthropic.APIError) return new ProviderFailedError('AI 서비스에 일시적인 문제가 있어요. 잠시 뒤에 다시 시도해 주세요.', e);
  return new ProviderFailedError('AI 요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.', e);
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic';
  readonly demo = false;
  private readonly client: AnthropicLike;

  constructor(
    private readonly settings: AiTaskSettings,
    client?: AnthropicLike,
    private readonly warn: (message: string) => void = (m) => console.warn(m),
  ) {
    this.client =
      client ??
      (new Anthropic({
        apiKey: settings.apiKey,
        baseURL: settings.baseURL,
        timeout: 120_000,
        maxRetries: 2,
      }) as unknown as AnthropicLike);
  }

  async propose({ request, signal }: ProposeInput): Promise<ProviderResult> {
    const params = {
      model: this.settings.model,
      max_tokens: this.settings.maxTokens,
      // 프롬프트 캐싱: 시스템 프롬프트는 모든 사용자에게 같아서 캐시에서 읽을 수 있다. 너무 짧으면(모델별 최소 길이 미만) 조용히 캐시되지 않는다.
      system:
        this.settings.promptCache === 'off'
          ? this.settings.systemPrompt
          : [{ type: 'text', text: this.settings.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages: buildMessages(request, { cacheDocument: this.settings.promptCache === 'document' }),
      // 구조화된 출력: 응답이 AiOutputSchema 모양의 JSON 으로 보장된다. effort 는 기본값에 기대지 않고 명시한다.
      output_config: { effort: this.settings.effort, format: zodOutputFormat(AiOutputSchema) },
    };

    let message: ParsedMessage;
    try {
      message = this.settings.fallbacks ? await this.withFallback(params, signal) : await this.client.messages.parse(params, { signal });
    } catch (e) {
      throw mapAnthropicError(e);
    }

    const usage = usageOf(message, this.settings.model);
    if (message.stop_reason === 'refusal') throw new ProviderRefusedError(undefined, usage);
    if (message.stop_reason === 'max_tokens') {
      throw new ProviderFailedError('AI 응답이 너무 길어 중간에 끊겼어요. 문서를 나누어 다시 시도해 주세요.', undefined, usage);
    }
    const out = message.parsed_output;
    if (!out) throw new ProviderFailedError('AI 응답을 이해하지 못했어요. 다시 시도해 주세요.', undefined, usage);
    return { reply: out.reply, proposals: out.proposals, usage };
  }

  /**
   * 대체 모델 옵션(베타)을 켜서 보낸다. 서버가 이 옵션을 받아들이지 않으면(400) 한 번만 옵션 없이 다시 보낸다.
   * 그 경우 운영자가 알아챌 수 있도록 경고를 남긴다(설정 파일에서 fallbacks: "off" 로 끌 수 있다).
   */
  private async withFallback(params: Record<string, unknown>, signal: AbortSignal | undefined): Promise<ParsedMessage> {
    try {
      return await this.client.beta.messages.parse({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, { signal });
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError && /fallback|beta/i.test(e.message)) {
        this.warn(`대체 모델 옵션을 AI 서비스가 받아들이지 않아 옵션 없이 다시 시도합니다. (${describeError(e)}) 계속되면 AI 설정 파일에서 fallbacks 를 "off" 로 바꾸세요.`);
        return this.client.messages.parse(params, { signal });
      }
      throw e;
    }
  }
}
