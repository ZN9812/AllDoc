import Anthropic from '@anthropic-ai/sdk';
import type { AiRequest } from '@alldoc/shared';
import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../test-support/helpers';
import { AnthropicProvider, FALLBACK_BETA, mapAnthropicError, usageOf, type AnthropicLike } from './anthropic';
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
    // 시스템 프롬프트는 캐시 표시를 붙여 보낸다(기본 promptCache=system). 문서는 마지막 사용자 메시지에 그대로 있다.
    expect(params.system).toEqual([{ type: 'text', text: expect.stringContaining('편집 도우미'), cache_control: { type: 'ephemeral' } }]);
    expect(params.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(params.messages.at(-1).content).toContain('<document kind="docx">');
    expect(params.tool_choice).toBeUndefined();
  });

  it('설정 파일의 모델·강도·프롬프트가 그대로 요청에 실린다', async () => {
    const { client, beta } = fakeClient();
    const s = settings({}, { tasks: { chat: { model: 'my-tuned', effort: 'high', maxTokens: 4000, systemPrompt: '내 지시문' } } });
    await new AnthropicProvider(s, client).propose({ request });
    expect(beta.mock.calls[0]?.[0]).toMatchObject({ model: 'my-tuned', max_tokens: 4000, system: [{ text: '내 지시문' }], output_config: { effort: 'high' } });
  });

  it('promptCache=off 면 캐시 표시 없이 문자열로 보낸다', async () => {
    const { client, beta } = fakeClient();
    await new AnthropicProvider(settings({}, { default: { promptCache: 'off' } }), client).propose({ request });
    const params = beta.mock.calls[0]?.[0];
    expect(typeof params.system).toBe('string');
    expect(JSON.stringify(params)).not.toContain('cache_control');
  });

  it('promptCache=document 면 문서를 맨 앞에 따로 두고 캐시 표시를 붙인다(캐시 표시는 2곳, 상한 4곳)', async () => {
    const { client, beta } = fakeClient();
    await new AnthropicProvider(settings({}, { default: { promptCache: 'document' } }), client).propose({ request });
    const params = beta.mock.calls[0]?.[0];
    expect(params.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: expect.stringContaining('<document kind="docx">'), cache_control: { type: 'ephemeral' } }] });
    expect(params.messages.at(-1).content).toContain('<instruction>');
    expect(params.messages.at(-1).content).not.toContain('<document');
    expect(JSON.stringify(params).match(/cache_control/g)).toHaveLength(2);
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

describe('Claude 응답의 사용량', () => {
  const top = { input_tokens: 1_200, output_tokens: 300, cache_creation_input_tokens: 50, cache_read_input_tokens: 700, cache_creation: { ephemeral_1h_input_tokens: 10 } };

  it('대체 모델 없이 답하면 맨 위 usage 를 쓰고 답한 모델을 기록한다', async () => {
    const { client } = fakeClient({ beta: vi.fn().mockResolvedValue({ ...ok, model: 'claude-opus-5-5', usage: { ...top, iterations: null } }) });
    const r = await new AnthropicProvider(settings(), client).propose({ request });
    expect(r.usage).toEqual({
      modelRequested: 'claude-opus-5-5',
      modelServed: 'claude-opus-5-5',
      fallback: false,
      parts: [{ model: 'claude-opus-5-5', inputTokens: 1_200, outputTokens: 300, cacheWriteTokens: 50, cacheWrite1hTokens: 10, cacheReadTokens: 700 }],
    });
  });

  it('대체 모델이 답하면 맨 위 값이 아니라 시도별 값(iterations)을 모두 남긴다', () => {
    const u = usageOf(
      {
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 900, // 마지막 시도만 담긴 값: 쓰지 않는다
          output_tokens: 80,
          iterations: [
            { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 900, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            { type: 'compaction', input_tokens: 9_999, output_tokens: 9_999 },
          ],
        },
      },
      'claude-opus-5-5',
    );
    expect(u?.fallback).toBe(true);
    expect(u?.modelServed).toBe('claude-opus-4-8');
    expect(u?.parts.map((p) => [p.model, p.inputTokens, p.outputTokens])).toEqual([
      ['claude-opus-5-5', 1_000, 5],
      ['claude-opus-4-8', 900, 80],
    ]);
  });

  it('응답에 usage 가 없으면 비워 둔다', () => {
    expect(usageOf({}, 'claude-opus-5-5')).toBeUndefined();
  });

  it('거절·끊김·형식 오류도 과금될 수 있어 사용량을 오류에 담는다', async () => {
    const withUsage = (m: object) => fakeClient({ beta: vi.fn().mockResolvedValue({ ...m, model: 'claude-opus-5-5', usage: top }) });
    const refused = await new AnthropicProvider(settings(), withUsage({ stop_reason: 'refusal', parsed_output: null }).client).propose({ request }).catch((e) => e);
    expect(refused).toBeInstanceOf(ProviderRefusedError);
    expect(refused.usage?.parts[0]?.inputTokens).toBe(1_200);
    const cut = await new AnthropicProvider(settings(), withUsage({ stop_reason: 'max_tokens', parsed_output: null }).client).propose({ request }).catch((e) => e);
    expect(cut).toBeInstanceOf(ProviderFailedError);
    expect(cut.usage?.parts[0]?.outputTokens).toBe(300);
    const bad = await new AnthropicProvider(settings(), withUsage({ stop_reason: 'end_turn', parsed_output: null }).client).propose({ request }).catch((e) => e);
    expect(bad.usage?.modelServed).toBe('claude-opus-5-5');
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
