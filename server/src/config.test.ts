import { describe, expect, it, vi } from 'vitest';
import { ConfigError, DEFAULT_MODEL } from './config';
import { testConfig } from './test-support/helpers';

const problems = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
};

describe('서버 설정', () => {
  it('기본값: 한도 5회, 한국 시간, Claude 기본 모델', () => {
    const c = testConfig({ DAILY_AI_LIMIT: '', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' });
    expect(c.dailyLimit).toBe(5);
    expect(c.timezone).toBe('Asia/Seoul');
    expect(c.ai.chat.model).toBe(DEFAULT_MODEL);
    expect(c.ai.chat.effort).toBe('medium');
    expect(c.ai.chat.fallbacks).toBe(true);
    expect(c.ai.chat.apiKey).toBe('k');
  });

  it('구글 로그인에는 클라이언트 ID 와 비밀이 필요하다', () => {
    const p = problems(() => testConfig({ AUTH_MODE: 'google' }));
    expect(p.join('\n')).toContain('GOOGLE_CLIENT_ID');
    const ok = testConfig({ AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' });
    expect(ok.google).toEqual({ clientId: 'id', clientSecret: 'secret' });
  });

  it('개발용 로그인은 운영 환경에서 쓸 수 없다', () => {
    expect(problems(() => testConfig({ AUTH_MODE: 'dev', NODE_ENV: 'production' })).join('\n')).toContain('운영');
  });

  it('운영에서는 세션 비밀이 필수이고 32자 이상이어야 한다', () => {
    const base = { AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'i', GOOGLE_CLIENT_SECRET: 's', NODE_ENV: 'production' };
    expect(problems(() => testConfig({ ...base, SESSION_SECRET: '' })).join('\n')).toContain('SESSION_SECRET');
    expect(problems(() => testConfig({ ...base, SESSION_SECRET: 'short' })).join('\n')).toContain('32자');
  });

  it('개발 중 세션 비밀이 없으면 임시 값을 만들고 알린다', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const c = testConfig({ SESSION_SECRET: '' });
      expect(c.sessionSecret).toBe('r'.repeat(64));
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('잘못된 시간대·포트는 시작할 때 알려 준다', () => {
    expect(problems(() => testConfig({ APP_TIMEZONE: 'Mars/Base' })).join('\n')).toContain('APP_TIMEZONE');
    expect(() => testConfig({ PORT: '99999' })).toThrow(ConfigError);
  });

  it('PUBLIC_URL 이 https 면 보안 쿠키를 쓰고, 끝의 슬래시는 뗀다', () => {
    const c = testConfig({ PUBLIC_URL: 'https://docs.example.com/' });
    expect(c.publicUrl).toBe('https://docs.example.com');
    expect(c.secureCookies).toBe(true);
    expect(c.allowedOrigins).toContain('https://docs.example.com');
  });

  it('허용 출처를 더하고, 잘못된 주소는 거절한다', () => {
    expect(testConfig({ ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com:8443' }).allowedOrigins).toEqual(
      expect.arrayContaining(['https://a.example.com', 'https://b.example.com:8443']),
    );
    expect(() => testConfig({ ALLOWED_ORIGINS: 'not a url' })).toThrow(ConfigError);
  });
});

describe('AI 설정 파일', () => {
  const file = (obj: unknown) => ({ 'ai.json': JSON.stringify(obj) });
  const env = { AI_CONFIG_PATH: '/etc/alldoc/ai.json', AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'base-key' };

  it('작업별로 모델·추론 강도·프롬프트를 바꾼다', () => {
    const c = testConfig(
      env,
      file({
        default: { model: 'claude-sonnet-5-5', maxTokens: 8000 },
        tasks: { format_check: { model: 'my-tuned-model', effort: 'high', systemPromptAppend: '표 안의 글은 건드리지 마세요.' } },
      }),
    );
    expect(c.ai.chat.model).toBe('claude-sonnet-5-5');
    expect(c.ai.chat.maxTokens).toBe(8000);
    expect(c.ai.format_check.model).toBe('my-tuned-model');
    expect(c.ai.format_check.effort).toBe('high');
    expect(c.ai.format_check.systemPrompt).toContain('표 안의 글은 건드리지 마세요.');
    expect(c.ai.format_check.systemPrompt).toContain('서식 점검');
    expect(c.ai.chat.systemPrompt).not.toContain('표 안의 글');
  });

  it('시스템 프롬프트를 통째로 바꾸거나 파일에서 읽는다', () => {
    const replaced = testConfig(env, file({ tasks: { chat: { systemPrompt: '나만의 지시문' } } }));
    expect(replaced.ai.chat.systemPrompt).toBe('나만의 지시문');
    const fromFile = testConfig(env, { ...file({ default: { systemPromptFile: 'prompt.txt' } }), 'prompt.txt': '파일에서 읽은 지시문' });
    expect(fromFile.ai.chat.systemPrompt).toBe('파일에서 읽은 지시문');
  });

  it('작업마다 다른 키와 호환 주소를 쓸 수 있다', () => {
    const c = testConfig(
      { ...env, TUNED_KEY: 'tuned-secret' },
      file({ tasks: { format_check: { apiKeyEnv: 'TUNED_KEY', baseURL: 'https://gateway.example.com' } } }),
    );
    expect(c.ai.format_check.apiKey).toBe('tuned-secret');
    expect(c.ai.format_check.baseURL).toBe('https://gateway.example.com');
    expect(c.ai.chat.apiKey).toBe('base-key');
  });

  it('대체 모델 옵션은 기본으로 켜져 있고 설정으로 끈다', () => {
    expect(testConfig(env, file({})).ai.chat.fallbacks).toBe(true);
    expect(testConfig(env, file({ default: { fallbacks: 'off' } })).ai.chat.fallbacks).toBe(false);
  });

  it('모르는 항목·잘못된 값·충돌은 시작할 때 알려 준다', () => {
    expect(problems(() => testConfig(env, file({ default: { modle: 'x' } }))).length).toBeGreaterThan(0);
    expect(problems(() => testConfig(env, file({ default: { effort: 'extreme' } }))).length).toBeGreaterThan(0);
    expect(problems(() => testConfig(env, file({ default: { systemPrompt: 'a', systemPromptFile: 'b' } }))).join('\n')).toContain('함께 쓸 수 없어요');
    expect(problems(() => testConfig(env, file({ default: { apiKeyEnv: 'MISSING_ENV' } }))).join('\n')).toContain('MISSING_ENV');
    expect(problems(() => testConfig({ AI_CONFIG_PATH: '/nope.json' })).join('\n')).toContain('읽지 못했어요');
  });
});
