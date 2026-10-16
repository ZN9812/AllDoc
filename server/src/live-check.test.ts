import Anthropic from '@anthropic-ai/sdk';
import { AI_TASKS, type AiTask } from '@alldoc/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AnthropicLike } from './ai/anthropic';
import { formatLiveCheck, parseLiveArgs, runLiveCheck, sampleRequest } from './live-check';
import { testConfig } from './test-support/helpers';

// 진짜 호출 확인 도구를 가짜 클라이언트로 시험한다(진짜 API 는 부르지 않는다).
const settings = (env: Record<string, string> = {}) => testConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k', ...env }).ai;

/** 부를 때마다 n 번째 응답. 첫 호출은 캐시를 쓰고 두 번째부터 캐시에서 읽는 것처럼 */
function fake(opts: { cacheRead?: boolean; rejectBeta?: boolean; refuse?: boolean } = {}) {
  let n = 0;
  const reply = () => {
    n++;
    return {
      stop_reason: opts.refuse ? 'refusal' : 'end_turn',
      parsed_output: opts.refuse ? null : { reply: '확인했어요', proposals: [] },
      model: 'claude-opus-5-5',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_creation_input_tokens: n === 1 ? 3000 : 0,
        cache_read_input_tokens: n > 1 && opts.cacheRead !== false ? 3000 : 0,
        iterations: [{ type: 'message', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: n === 1 ? 3000 : 0, cache_read_input_tokens: n > 1 && opts.cacheRead !== false ? 3000 : 0 }],
      },
    };
  };
  const stable = vi.fn(async () => reply());
  const beta = vi.fn(async () => {
    if (opts.rejectBeta) throw Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'unknown beta' } }, 'unknown beta', new Headers());
    return reply();
  });
  const client = { messages: { parse: stable }, beta: { messages: { parse: beta } } } as unknown as AnthropicLike;
  return { client, stable, beta };
}

describe('진짜 Claude 호출 확인 도구', () => {
  it('작업 4개의 예시 요청은 서버 스키마를 통과하고, tex_fix 는 컴파일 결과를 함께 보낸다', () => {
    for (const t of AI_TASKS) expect(() => sampleRequest(t)).not.toThrow();
    expect(sampleRequest('tex_fix').compile?.diagnostics).toHaveLength(1);
    expect(sampleRequest('tex_chat').document.kind).toBe('tex');
  });

  it('작업마다 두 번 부르고, 두 번째 호출의 캐시 읽기·대체 모델 옵션 수락·원가를 모은다', async () => {
    const f = fake();
    const r = await runLiveCheck({ settings: settings(), makeClient: () => f.client, now: () => new Date('2026-10-15T00:00:00Z') });
    expect(r.calls).toHaveLength(8);
    expect(f.beta).toHaveBeenCalledTimes(8);
    expect(r.checks).toMatchObject({ allOk: true, usageReported: true, fallbackBetaAccepted: true, iterationTypes: ['message'], modelsServed: ['claude-opus-5-5'] });
    expect(r.checks.cacheHit).toEqual({ chat: true, format_check: true, tex_chat: true, tex_fix: true });
    // 입력 1000×$4 + 출력 200×$20 + 캐시 쓰기 3000×$5 (100만 토큰당) = 23,000 마이크로달러
    expect(r.calls[0]).toMatchObject({ task: 'chat', attempt: 1, costMicroUsd: 23_000, cacheWriteTokens: 3000, cacheReadTokens: 0 });
    expect(formatLiveCheck(r)).toContain('캐시 적중(두 번째 호출부터): chat 예');
  });

  it('캐시를 읽지 못하면 아니오, 한 번만 부르면 해당 없음', async () => {
    const r = await runLiveCheck({ settings: settings(), tasks: ['chat'], makeClient: () => fake({ cacheRead: false }).client });
    expect(r.checks.cacheHit).toEqual({ chat: false });
    const once = await runLiveCheck({ settings: settings(), tasks: ['chat'], repeat: 1, makeClient: () => fake().client });
    expect(once.checks.cacheHit).toEqual({ chat: null });
  });

  it('대체 모델 옵션을 거절당해 옵션 없이 다시 보냈으면 수락하지 않은 것으로 보고 경고를 모은다', async () => {
    const f = fake({ rejectBeta: true });
    const r = await runLiveCheck({ settings: settings(), tasks: ['chat'], repeat: 1, makeClient: () => f.client });
    expect(r.checks.allOk).toBe(true);
    expect(r.checks.fallbackBetaAccepted).toBe(false);
    expect(r.warnings.join('\n')).toContain('대체 모델 옵션');
  });

  it('거절은 refused 로 남기고 모두 성공이 아니다. 결과에 예시 문서의 글이 들어가지 않는다', async () => {
    const r = await runLiveCheck({ settings: settings(), tasks: ['chat'], repeat: 1, makeClient: () => fake({ refuse: true }).client });
    expect(r.calls[0]?.outcome).toBe('refused');
    expect(r.checks.allOk).toBe(false);
    expect(JSON.stringify(r)).not.toContain('몇일');
  });

  it('키가 없거나 데모 AI 설정이면 부르지 않고 알린다', async () => {
    await expect(runLiveCheck({ settings: testConfig({ AI_PROVIDER: 'mock' }).ai, makeClient: () => fake().client })).rejects.toThrow('anthropic 이 아니에요');
    await expect(runLiveCheck({ settings: testConfig({ AI_PROVIDER: 'anthropic' }).ai, makeClient: () => fake().client })).rejects.toThrow('API 키가 없어요');
  });

  it('명령줄: 기본 2번·모든 작업, --yes 가 없으면 돌지 않음을 알 수 있다', () => {
    expect(parseLiveArgs([])).toEqual({ yes: false, repeat: 2, tasks: [...AI_TASKS], out: null });
    expect(parseLiveArgs(['--yes', '--repeat', '3', '--tasks', 'chat,tex_fix', '--out', 'r.json'])).toEqual({ yes: true, repeat: 3, tasks: ['chat', 'tex_fix'] as AiTask[], out: 'r.json' });
    expect(() => parseLiveArgs(['--repeat', '9'])).toThrow('--repeat');
    expect(() => parseLiveArgs(['--tasks', 'nope'])).toThrow('모르는 작업');
  });
});
