import Anthropic from '@anthropic-ai/sdk';
import type { AiRequest } from '@alldoc/shared';
import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../test-support/helpers';
import { AnthropicProvider, FALLBACK_BETA, mapAnthropicError, type AnthropicLike } from './anthropic';
import { ProviderFailedError, ProviderRefusedError } from './types';

const request: AiRequest = {
  mode: 'chat',
  instruction: '맞춤법을 확인해 줘',
  document: { kind: 'docx', paragraphs: [{ index: 0, text: '몇일 걸려요', char: {}, para: {} }] },
};

const output = { reply: '하나 찾았어요', proposals: [] };
const ok = { stop_reason: 'end_turn', parsed_output: output };

function settings(env: Record<string, string> = {}, file?: object) {
  const c = testConfig(
    { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ...(file ? { AI_CONFIG_PATH: '/x/ai.json' } : {}), ...env },
    file ? { 'ai.json': JSON.stringify(file) } : {},
  );
  return c.ai.chat;
}

function fakeClient(over: Partial<{ stable: ReturnType<typeof vi.fn>; beta: ReturnType<typeof vi.fn> }> = {}) {
  const stable = over.stable ?? vi.fn().mockResolvedValue(ok);
  const beta = over.beta ?? vi.fn().mockResolvedValue(ok);
  const client = { messages: { parse: stable }, beta: { messages: { parse: beta } } } as unknown as AnthropicLike;
  return { client, stable, beta };
}

const apiError = (status: number, message = 'x') => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());

describe('Claude 연결부', () => {
  it('기본 설정: 모델·추론 강도·구조화 출력을 명시하고, 대체 모델 옵션(베타)을 켜서 보낸다', async () => {
    const { client, stable, beta } = fakeClient();
    const r = await new AnthropicProvider(settings(), client).propose({ request });
    expect(r).toEqual(output);
    expect(stable).not.toHaveBeenCalled();
    const params = beta.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
    });
    expect(params.output_config.format).toMatchObject({ type: 'json_schema' });
    expect(params.system).toContain('편집 도우미');
    expect(params.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(params.messages.at(-1).content).toContain('<document kind="docx">');
    expect(params.tool_choice).toBeUndefined();
  });

  it('설정 파일의 모델·강도·프롬프트가 그대로 요청에 실린다', async () => {
    const { client, beta } = fakeClient();
    const s = settings({}, { tasks: { chat: { model: 'my-tuned', effort: 'high', maxTokens: 4000, systemPrompt: '내 지시문' } } });
    await new AnthropicProvider(s, client).propose({ request });
    expect(beta.mock.calls[0]?.[0]).toMatchObject({ model: 'my-tuned', max_tokens: 4000, system: '내 지시문', output_config: { effort: 'high' } });
  });

  it('fallbacks 를 끄면 베타가 아닌 일반 호출을 쓴다', async () => {
    const { client, stable, beta } = fakeClient();
    await new AnthropicProvider(settings({}, { default: { fallbacks: 'off' } }), client).propose({ request });
    expect(beta).not.toHaveBeenCalled();
    const params = stable.mock.calls[0]?.[0];
    expect(params.betas).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
  });

  it('베타 옵션을 서비스가 받아들이지 않으면(400) 한 번만 옵션 없이 다시 보내고 경고를 남긴다', async () => {
    const { client, stable, beta } = fakeClient({ beta: vi.fn().mockRejectedValue(apiError(400, 'unknown beta: server-side-fallback')) });
    const warn = vi.fn();
    const r = await new AnthropicProvider(settings(), client, warn).propose({ request });
    expect(r).toEqual(output);
    expect(beta).toHaveBeenCalledTimes(1);
    expect(stable).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('fallbacks');
  });

  it('베타와 상관없는 400 은 다시 시도하지 않고 오류로 알린다', async () => {
    const { client, stable } = fakeClient({ beta: vi.fn().mockRejectedValue(apiError(400, 'prompt is too long')) });
    await expect(new AnthropicProvider(settings(), client).propose({ request })).rejects.toBeInstanceOf(ProviderFailedError);
    expect(stable).not.toHaveBeenCalled();
  });

  it('모델이 정책상 거절하면 거절로 구분한다', async () => {
    const { client } = fakeClient({ beta: vi.fn().mockResolvedValue({ stop_reason: 'refusal', parsed_output: null }) });
    await expect(new AnthropicProvider(settings(), client).propose({ request })).rejects.toBeInstanceOf(ProviderRefusedError);
  });

  it('응답이 도중에 끊기거나 형식을 알 수 없으면 실패로 알린다', async () => {
    const cut = fakeClient({ beta: vi.fn().mockResolvedValue({ stop_reason: 'max_tokens', parsed_output: null }) });
    await expect(new AnthropicProvider(settings(), cut.client).propose({ request })).rejects.toThrow('끊겼어요');
    const bad = fakeClient({ beta: vi.fn().mockResolvedValue({ stop_reason: 'end_turn', parsed_output: null }) });
    await expect(new AnthropicProvider(settings(), bad.client).propose({ request })).rejects.toThrow('이해하지 못했어요');
  });

  it('중단 신호를 서비스 호출에 넘긴다', async () => {
    const { client, beta } = fakeClient();
    const ac = new AbortController();
    await new AnthropicProvider(settings(), client).propose({ request, signal: ac.signal });
    expect(beta.mock.calls[0]?.[1]).toEqual({ signal: ac.signal });
  });
});

describe('Claude 오류를 사용자 문장으로', () => {
  it('원문(키·요청 번호 등)을 사용자에게 그대로 보이지 않는다', () => {
    const cases: Array<[number, string]> = [
      [401, '인증'],
      [403, '인증'],
      [429, '혼잡'],
      [400, '받아들이지'],
      [500, '일시적인'],
      [529, '일시적인'],
    ];
    for (const [status, word] of cases) {
      const e = mapAnthropicError(apiError(status, 'sk-ant-secret request_id=req_123'));
      expect(e).toBeInstanceOf(ProviderFailedError);
      expect(e.message).toContain(word);
      expect(e.message).not.toContain('sk-ant');
      expect(e.message).not.toContain('req_123');
    }
    expect(mapAnthropicError(new Anthropic.APIConnectionError({ message: 'down' })).message).toContain('연결하지 못했어요');
    expect(mapAnthropicError(new Error('boom')).message).toContain('처리하지 못했어요');
  });

  it('사용자가 취소한 요청과 이미 분류된 오류는 그대로 둔다', () => {
    const abort = new Anthropic.APIUserAbortError();
    expect(mapAnthropicError(abort)).toBe(abort);
    const refused = new ProviderRefusedError();
    expect(mapAnthropicError(refused)).toBe(refused);
  });
});
