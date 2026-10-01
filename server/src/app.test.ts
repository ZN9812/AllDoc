import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiRequest, AiResponse, ErrorResponse, MeResponse } from '@alldoc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app';
import { MockProvider } from './ai/mock';
import { ProviderFailedError, ProviderRefusedError, type AiProvider, type ProviderResult } from './ai/types';
import { QuotaStore } from './quota';
import { testConfig } from './test-support/helpers';

const NOW = new Date('2026-10-01T03:00:00Z'); // 한국 시간 12시

const doc = { kind: 'docx' as const, paragraphs: [{ index: 0, text: '몇일 뒤에 만나요', char: {}, para: {} }] };
const chatBody = (over: Partial<AiRequest> = {}): AiRequest => ({ mode: 'chat', instruction: '맞춤법을 확인해 줘', document: doc, ...over });

function setup(env: Record<string, string> = {}, over: Partial<AppDeps> = {}) {
  const dist = mkdtempSync(join(tmpdir(), 'alldoc-web-'));
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>AllDoc</title>');
  writeFileSync(join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dist, 'favicon.svg'), '<svg/>');

  const config = testConfig({ WEB_DIST: dist, ...env });
  const quota = new QuotaStore(':memory:');
  const provider = new MockProvider();
  const deps: AppDeps = {
    config,
    quota,
    providers: { chat: provider, format_check: provider },
    now: () => NOW,
    log: () => undefined,
    ...over,
  };
  const app = createApp(deps);
  return { app, quota, config, deps };
}

type App = ReturnType<typeof setup>['app'];

async function login(app: App, user = '테스터'): Promise<string> {
  const res = await app.request(`/api/auth/login?user=${encodeURIComponent(user)}&next=/edit/1`);
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe('/edit/1');
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] as string;
}

const post = (app: App, body: unknown, cookie?: string, headers: Record<string, string> = {}) =>
  app.request('/api/ai/propose', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const errorOf = async (res: Response) => ((await res.json()) as ErrorResponse).error;

describe('내 정보(/api/me)', () => {
  it('로그인 전에는 로그인하지 않은 상태와 AI 연결 상태를 알려 준다', async () => {
    const { app } = setup();
    const me = (await (await app.request('/api/me')).json()) as MeResponse;
    expect(me).toMatchObject({ authMode: 'dev', authenticated: false, user: null, quota: null, ai: { available: true, demo: true, provider: 'mock' } });
  });

  it('로그인하면 이름과 오늘 남은 횟수를 알려 준다', async () => {
    const { app } = setup();
    const cookie = await login(app);
    const me = (await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;
    expect(me).toMatchObject({ authenticated: true, user: { name: '테스터' }, quota: { limit: 3, used: 0, remaining: 3 } });
  });

  it('위조한 쿠키는 로그인으로 치지 않는다', async () => {
    const { app } = setup();
    const me = (await (await app.request('/api/me', { headers: { cookie: 'alldoc_session=eyJ1Ijp7ImlkIjoieCJ9LCJleHAiOjk5OTk5OTk5OTl9.AAAA' } })).json()) as MeResponse;
    expect(me.authenticated).toBe(false);
  });

  it('AI 가 연결되지 않았으면 그렇게 알려 준다', async () => {
    const { app } = setup({}, { providers: { chat: null, format_check: null } });
    const me = (await (await app.request('/api/me')).json()) as MeResponse;
    expect(me.ai).toEqual({ available: false, demo: false, provider: 'none' });
  });

  it('응답은 캐시하지 않고, 보안 헤더를 붙인다', async () => {
    const { app } = setup();
    const res = await app.request('/api/me');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});

describe('로그인 방식', () => {
  it('로그아웃하면 쿠키를 지운다', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('alldoc_session=;');
  });

  it('none 방식: 로그인 없이 AI 를 쓰고 한도가 없다', async () => {
    const { app } = setup({ AUTH_MODE: 'none', SESSION_SECRET: '' });
    const me = (await (await app.request('/api/me')).json()) as MeResponse;
    expect(me).toMatchObject({ authMode: 'none', authenticated: false, quota: null });
    for (let i = 0; i < 5; i++) expect((await post(app, chatBody())).status).toBe(200);
  });

  it('로그인 뒤 돌아갈 주소는 사이트 안으로 제한한다', async () => {
    const { app } = setup();
    const res = await app.request('/api/auth/login?next=https://evil.example');
    expect(res.headers.get('location')).toBe('/');
  });
});

describe('구글 로그인', () => {
  const env = { AUTH_MODE: 'google', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', PUBLIC_URL: 'https://docs.example.com' };

  function fakeGoogle() {
    return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at' });
      return Response.json({ sub: '1234', name: '홍길동', email: 'hong@example.com' });
    });
  }

  it('로그인 주소로 가면 구글 동의 화면(PKCE 포함)으로 보내고 상태 쿠키를 둔다', async () => {
    const { app } = setup(env);
    const res = await app.request('/api/auth/login?next=/docs');
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location') as string);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('cid');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://docs.example.com/api/auth/callback');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('code_challenge')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBeTruthy();
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('alldoc_oauth=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
  });

  it('돌아온 요청의 state 가 맞으면 세션을 만들고 원래 가려던 곳으로 보낸다', async () => {
    const f = fakeGoogle();
    const { app } = setup(env, { fetch: f as unknown as typeof fetch });
    const start = await app.request('/api/auth/login?next=/docs');
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string;
    const oauthCookie = (start.headers.get('set-cookie') as string).split(';')[0] as string;

    const done = await app.request(`/api/auth/callback?code=abc&state=${state}`, { headers: { cookie: oauthCookie } });
    expect(done.status).toBe(302);
    expect(done.headers.get('location')).toBe('/docs');
    const sessionCookie = (done.headers.getSetCookie().find((c) => c.startsWith('alldoc_session=')) as string).split(';')[0] as string;

    const tokenCall = f.mock.calls.find((c) => String(c[0]).includes('/token'));
    const sent = new URLSearchParams(String((tokenCall?.[1] as RequestInit).body));
    expect(sent.get('code')).toBe('abc');
    expect(sent.get('code_verifier')).toBeTruthy();
    expect(sent.get('client_secret')).toBe('csecret');

    const me = (await (await app.request('/api/me', { headers: { cookie: sessionCookie } })).json()) as MeResponse;
    expect(me).toMatchObject({ authenticated: true, user: { name: '홍길동', email: 'hong@example.com', picture: null } });
  });

  it('state 가 다르거나 쿠키가 없으면 로그인하지 않는다', async () => {
    const f = fakeGoogle();
    const { app } = setup(env, { fetch: f as unknown as typeof fetch });
    const start = await app.request('/api/auth/login');
    const oauthCookie = (start.headers.get('set-cookie') as string).split(';')[0] as string;
    const wrongState = await app.request('/api/auth/callback?code=abc&state=nope', { headers: { cookie: oauthCookie } });
    expect(wrongState.headers.get('location')).toBe('/?login=failed');
    const noCookie = await app.request('/api/auth/callback?code=abc&state=nope');
    expect(noCookie.headers.get('location')).toBe('/?login=failed');
    expect(f).not.toHaveBeenCalled();
  });

  it('구글이 오류를 돌려주면 실패로 돌려보낸다', async () => {
    const f = vi.fn(async () => new Response('bad', { status: 400 }));
    const { app } = setup(env, { fetch: f as unknown as typeof fetch });
    const start = await app.request('/api/auth/login');
    const state = new URL(start.headers.get('location') as string).searchParams.get('state') as string;
    const oauthCookie = (start.headers.get('set-cookie') as string).split(';')[0] as string;
    const res = await app.request(`/api/auth/callback?code=abc&state=${state}`, { headers: { cookie: oauthCookie } });
    expect(res.headers.get('location')).toBe('/?login=failed');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('alldoc_session=') && !c.startsWith('alldoc_session=;'))).toBe(false);
  });
});

describe('AI 제안(/api/ai/propose)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('로그인이 필요하다', async () => {
    const res = await post(ctx.app, chatBody());
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('unauthenticated');
  });

  it('제안과 남은 횟수를 돌려주고, 데모임을 알린다', async () => {
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AiResponse;
    expect(body.demo).toBe(true);
    expect(body.proposals[0]).toMatchObject({ category: 'spelling', ops: [{ type: 'replaceText', paragraph: 0, find: '몇일', replace: '며칠' }] });
    expect(body.proposals[0]?.id).toMatch(/^ai-/);
    expect(body.quota).toEqual({ limit: 3, used: 1, remaining: 2 });
  });

  it('하루 한도를 넘으면 429 로 거절하고, 한도 안내에 시간대를 밝힌다', async () => {
    const cookie = await login(ctx.app);
    for (let i = 0; i < 3; i++) expect((await post(ctx.app, chatBody(), cookie)).status).toBe(200);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(429);
    const e = await errorOf(res);
    expect(e.code).toBe('quota_exceeded');
    expect(e.message).toContain('3회');
    expect(e.message).toContain('Asia/Seoul');
  });

  it('한도는 사용자마다 따로 센다', async () => {
    const a = await login(ctx.app, '가');
    const b = await login(ctx.app, '나');
    for (let i = 0; i < 3; i++) await post(ctx.app, chatBody(), a);
    expect((await post(ctx.app, chatBody(), a)).status).toBe(429);
    expect((await post(ctx.app, chatBody(), b)).status).toBe(200);
  });

  it('한국 시간 자정이 지나면 다시 쓸 수 있다', async () => {
    let now = new Date('2026-10-01T14:00:00Z'); // 23:00 KST
    ctx = setup({}, { now: () => now });
    const cookie = await login(ctx.app);
    for (let i = 0; i < 3; i++) await post(ctx.app, chatBody(), cookie);
    expect((await post(ctx.app, chatBody(), cookie)).status).toBe(429);
    now = new Date('2026-10-01T15:00:01Z'); // 00:00:01 KST (다음 날)
    expect((await post(ctx.app, chatBody(), cookie)).status).toBe(200);
  });

  it('AI 서비스 문제로 실패하면 502 로 알리고 사용 횟수를 돌려준다', async () => {
    const failing: AiProvider = { id: 'x', demo: false, propose: async () => { throw new ProviderFailedError('AI 서비스가 지금 혼잡해요.'); } };
    ctx = setup({}, { providers: { chat: failing, format_check: failing } });
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toEqual({ code: 'ai_failed', message: 'AI 서비스가 지금 혼잡해요.' });
    const me = (await (await ctx.app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;
    expect(me.quota?.used).toBe(0);
  });

  it('예상하지 못한 오류도 사용자에게 내부 내용을 보이지 않고 횟수를 돌려준다', async () => {
    const broken: AiProvider = { id: 'x', demo: false, propose: async () => { throw new Error('sk-secret internal'); } };
    ctx = setup({}, { providers: { chat: broken, format_check: broken } });
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('sk-secret');
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(0);
  });

  it('모델이 거절하면 422 로 알리고 횟수는 돌려주지 않는다', async () => {
    const refusing: AiProvider = { id: 'x', demo: false, propose: async () => { throw new ProviderRefusedError(); } };
    ctx = setup({}, { providers: { chat: refusing, format_check: refusing } });
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('ai_refused');
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(1);
  });

  it('같은 사용자의 요청이 끝나기 전에 또 보내면 거절하고 횟수를 쓰지 않는다', async () => {
    let release: (r: ProviderResult) => void = () => undefined;
    const slow: AiProvider = { id: 'x', demo: false, propose: () => new Promise<ProviderResult>((r) => (release = r)) };
    ctx = setup({}, { providers: { chat: slow, format_check: slow } });
    const cookie = await login(ctx.app);
    const first = post(ctx.app, chatBody(), cookie);
    await vi.waitFor(() => expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(1));
    const second = await post(ctx.app, chatBody(), cookie);
    expect(second.status).toBe(429);
    expect((await errorOf(second)).code).toBe('busy');
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(1);
    release({ reply: '끝', proposals: [] });
    expect((await first).status).toBe(200);
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(1);
  });

  it('AI 가 만든 제안 중 문서와 맞지 않는 것은 걸러내고 그 사실을 알린다', async () => {
    const sloppy: AiProvider = {
      id: 'x',
      demo: false,
      propose: async () => ({
        reply: '두 개 찾았어요.',
        proposals: [
          { category: 'spelling', title: '좋은 제안', description: 'd', before: '몇일', after: '며칠', ops: [{ type: 'replaceText', paragraph: 0, find: '몇일', replace: '며칠', fontFamily: null, fontSizePt: null, bold: null, italic: null, underline: null, align: null, lineSpacingPct: null }] },
          { category: 'spelling', title: '없는 문단', description: 'd', before: 'a', after: 'b', ops: [{ type: 'replaceText', paragraph: 42, find: 'a', replace: 'b', fontFamily: null, fontSizePt: null, bold: null, italic: null, underline: null, align: null, lineSpacingPct: null }] },
        ],
      }),
    };
    ctx = setup({}, { providers: { chat: sloppy, format_check: sloppy } });
    const body = (await (await post(ctx.app, chatBody(), await login(ctx.app))).json()) as AiResponse;
    expect(body.proposals).toHaveLength(1);
    expect(body.reply).toContain('1개는 제외했어요');
    expect(body.demo).toBe(false);
  });

  it('잘못된 요청은 400: 본문, 형식, 빈 지시, PDF', async () => {
    const cookie = await login(ctx.app);
    expect((await post(ctx.app, '{not json', cookie)).status).toBe(400);
    expect((await post(ctx.app, { mode: 'nope' }, cookie)).status).toBe(400);
    expect((await post(ctx.app, chatBody({ instruction: '   ' }), cookie)).status).toBe(400);
    expect((await post(ctx.app, chatBody({ document: { kind: 'pdf', paragraphs: [] } }), cookie)).status).toBe(400);
    const noRules = await post(ctx.app, chatBody({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: ' ' }), cookie);
    expect(noRules.status).toBe(400);
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(0);
  });

  it('문서가 너무 길면 413 으로 거절하고 횟수를 쓰지 않는다', async () => {
    const cookie = await login(ctx.app);
    const big = { kind: 'txt' as const, paragraphs: [{ index: 0, text: '가'.repeat(120_001), char: {}, para: {} }] };
    const res = await post(ctx.app, chatBody({ document: big }), cookie);
    expect(res.status).toBe(413);
    expect((await errorOf(res)).code).toBe('document_too_large');
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(0);
  });

  it('AI 가 연결되지 않은 서버는 503', async () => {
    ctx = setup({}, { providers: { chat: null, format_check: null } });
    const res = await post(ctx.app, chatBody(), await login(ctx.app));
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('ai_unavailable');
  });

  it('다른 사이트에서 보낸 요청은 거절한다(CSRF)', async () => {
    const cookie = await login(ctx.app);
    const evil = await post(ctx.app, chatBody(), cookie, { origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const crossSite = await post(ctx.app, chatBody(), cookie, { 'sec-fetch-site': 'cross-site' });
    expect(crossSite.status).toBe(403);
    const same = await post(ctx.app, chatBody(), cookie, { origin: 'http://localhost:8787' });
    expect(same.status).toBe(200);
    const vite = await post(ctx.app, chatBody(), cookie, { origin: 'http://localhost:5173' });
    expect(vite.status).toBe(200);
  });

  it('서식 점검(내 규칙)은 format_check 연결부로 간다', async () => {
    const chat: AiProvider = { id: 'chat', demo: false, propose: vi.fn(async () => ({ reply: 'chat', proposals: [] })) };
    const fmt: AiProvider = { id: 'fmt', demo: false, propose: vi.fn(async () => ({ reply: 'fmt', proposals: [] })) };
    ctx = setup({}, { providers: { chat, format_check: fmt } });
    const cookie = await login(ctx.app);
    const body = (await (await post(ctx.app, chatBody({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: '본문 11pt' }), cookie)).json()) as AiResponse;
    expect(body.reply).toBe('fmt');
    expect(chat.propose).not.toHaveBeenCalled();
  });
});

describe('웹 앱 제공', () => {
  const { app } = setup();

  it('주소가 앱 화면(/docs, /edit/..)이면 index.html 을 준다', async () => {
    for (const path of ['/', '/docs', '/settings', '/edit/abc-123']) {
      const res = await app.request(path);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toContain('<title>AllDoc</title>');
    }
  });

  it('해시가 붙은 파일은 오래 캐시하고, 없는 파일은 404', async () => {
    const hit = await app.request('/assets/app-abc123.js');
    expect(hit.status).toBe(200);
    expect(hit.headers.get('content-type')).toContain('text/javascript');
    expect(hit.headers.get('cache-control')).toContain('immutable');
    expect((await app.request('/assets/missing.js')).status).toBe(404);
    expect((await app.request('/favicon.svg')).headers.get('content-type')).toBe('image/svg+xml');
  });

  it('폴더 밖의 파일은 줄 수 없다', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/assets/..%2f..%2fsecret.txt', '/%00']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('없는 API 주소는 JSON 404', async () => {
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe('not_found');
  });

  it('웹 앱이 빌드되지 않았다면 안내한다', async () => {
    const empty = setup({ WEB_DIST: join(tmpdir(), 'alldoc-does-not-exist') });
    const res = await empty.app.request('/');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('npm run build');
  });

  it('상태 확인 주소', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });
});
