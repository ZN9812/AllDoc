import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ACCOUNT_DELETE_CONFIRM, type AiRequest, type AiResponse, type ErrorResponse, type MeResponse } from '@alldoc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app';
import { MockProvider } from './ai/mock';
import { ProviderFailedError, ProviderRefusedError, type AiProvider, type ProviderResult } from './ai/types';
import { AuditLog } from './audit';
import { deletedAlias } from './auth/deletion';
import { AccountStore } from './auth/accounts';
import { EntitlementStore } from './billing/entitlements';
import { openDb } from './db';
import { LedgerStore } from './ledger';
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
  const db = openDb(':memory:');
  const quota = new QuotaStore(db);
  const accounts = new AccountStore(db);
  const entitlements = new EntitlementStore(db, config);
  const provider = new MockProvider();
  const deps: AppDeps = {
    config,
    quota,
    accounts,
    entitlements,
    audit: new AuditLog(db),
    providers: { chat: provider, format_check: provider, tex_chat: provider, tex_fix: provider },
    now: () => NOW,
    log: () => undefined,
    ...over,
  };
  const app = createApp(deps);
  return { app, quota, accounts, entitlements, db, config, deps };
}

type App = ReturnType<typeof setup>['app'];
const ctxSecret = () => testConfig().sessionSecret;

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
    const { app } = setup({}, { providers: { chat: null, format_check: null, tex_chat: null, tex_fix: null } });
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
    ctx = setup({}, { providers: { chat: failing, format_check: failing, tex_chat: failing, tex_fix: failing } });
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(502);
    expect(await errorOf(res)).toEqual({ code: 'ai_failed', message: 'AI 서비스가 지금 혼잡해요.' });
    const me = (await (await ctx.app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;
    expect(me.quota?.used).toBe(0);
  });

  it('예상하지 못한 오류도 사용자에게 내부 내용을 보이지 않고 횟수를 돌려준다', async () => {
    const broken: AiProvider = { id: 'x', demo: false, propose: async () => { throw new Error('sk-secret internal'); } };
    ctx = setup({}, { providers: { chat: broken, format_check: broken, tex_chat: broken, tex_fix: broken } });
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('sk-secret');
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(0);
  });

  it('모델이 거절하면 422 로 알리고 횟수는 돌려주지 않는다', async () => {
    const refusing: AiProvider = { id: 'x', demo: false, propose: async () => { throw new ProviderRefusedError(); } };
    ctx = setup({}, { providers: { chat: refusing, format_check: refusing, tex_chat: refusing, tex_fix: refusing } });
    const cookie = await login(ctx.app);
    const res = await post(ctx.app, chatBody(), cookie);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('ai_refused');
    expect(ctx.quota.used('dev:테스터', '2026-10-01')).toBe(1);
  });

  it('같은 사용자의 요청이 끝나기 전에 또 보내면 거절하고 횟수를 쓰지 않는다', async () => {
    let release: (r: ProviderResult) => void = () => undefined;
    const slow: AiProvider = { id: 'x', demo: false, propose: () => new Promise<ProviderResult>((r) => (release = r)) };
    ctx = setup({}, { providers: { chat: slow, format_check: slow, tex_chat: slow, tex_fix: slow } });
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
    ctx = setup({}, { providers: { chat: sloppy, format_check: sloppy, tex_chat: sloppy, tex_fix: sloppy } });
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
    ctx = setup({}, { providers: { chat: null, format_check: null, tex_chat: null, tex_fix: null } });
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

  it('LaTeX 프로젝트의 대화는 tex_chat, 오류 고치기는 tex_fix 연결부로 가고, 원장에 작업 이름이 남는다', async () => {
    const mk = (name: string): AiProvider => ({ id: name, demo: false, propose: vi.fn(async () => ({ reply: name, proposals: [] })) });
    const chat = mk('chat');
    const texChat = mk('tex_chat');
    const texFix = mk('tex_fix');
    const db = openDb(':memory:');
    const ledger = new LedgerStore(db);
    ctx = setup({}, { providers: { chat, format_check: null, tex_chat: texChat, tex_fix: texFix }, ledger });
    const cookie = await login(ctx.app);
    const texDoc = { kind: 'tex' as const, paragraphs: [{ index: 1, text: '몇일 뒤', char: {}, para: {}, src: { file: 'main.tex', line: 3, role: 'body' as const } }] };
    const compile = { diagnostics: [{ severity: 'error' as const, file: 'main.tex', line: 3, message: 'x' }], logExcerpt: '' };
    expect(((await (await post(ctx.app, chatBody({ document: texDoc }), cookie)).json()) as AiResponse).reply).toBe('tex_chat');
    expect(((await (await post(ctx.app, chatBody({ mode: 'tex_fix', document: texDoc, compile }), cookie)).json()) as AiResponse).reply).toBe('tex_fix');
    expect(chat.propose).not.toHaveBeenCalled();
    expect(db.prepare('SELECT task FROM ai_events ORDER BY id').all()).toEqual([{ task: 'tex_chat' }, { task: 'tex_fix' }]);
  });

  it('LaTeX 의 서식 점검, 컴파일 결과 없는 오류 고치기, 위치(src) 없는 블록, LaTeX 가 아닌 문서의 오류 고치기는 400', async () => {
    ctx = setup();
    const cookie = await login(ctx.app);
    const texDoc = { kind: 'tex' as const, paragraphs: [{ index: 1, text: '가', char: {}, para: {}, src: { file: 'main.tex', line: 3, role: 'body' as const } }] };
    const compile = { diagnostics: [], logExcerpt: '' };
    expect((await post(ctx.app, chatBody({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: '11pt', document: texDoc }), cookie)).status).toBe(400);
    expect((await post(ctx.app, chatBody({ mode: 'tex_fix', document: texDoc }), cookie)).status).toBe(400);
    expect((await post(ctx.app, chatBody({ document: { kind: 'tex', paragraphs: [{ index: 1, text: '가', char: {}, para: {} }] } }), cookie)).status).toBe(400);
    expect((await post(ctx.app, chatBody({ mode: 'tex_fix', compile }), cookie)).status).toBe(400);
  });

  it('서식 점검(내 규칙)은 format_check 연결부로 간다', async () => {
    const chat: AiProvider = { id: 'chat', demo: false, propose: vi.fn(async () => ({ reply: 'chat', proposals: [] })) };
    const fmt: AiProvider = { id: 'fmt', demo: false, propose: vi.fn(async () => ({ reply: 'fmt', proposals: [] })) };
    ctx = setup({}, { providers: { chat, format_check: fmt, tex_chat: null, tex_fix: null } });
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

describe('계정과 세션 무효화', () => {
  const me = async (app: App, cookie: string) => (await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;

  it('로그인하면 계정이 생긴다', async () => {
    const { app, accounts } = setup();
    await login(app);
    expect(accounts.get('dev:테스터')).toMatchObject({ name: '테스터', status: 'active', sessionVersion: 1 });
  });

  it('세션 버전을 올리면(모든 기기 로그아웃) 옛 쿠키로는 로그인 상태가 아니고 AI 도 401', async () => {
    const { app, accounts } = setup();
    const cookie = await login(app);
    expect((await me(app, cookie)).authenticated).toBe(true);
    accounts.bumpSession('dev:테스터');
    expect((await me(app, cookie)).authenticated).toBe(false);
    expect((await post(app, chatBody(), cookie)).status).toBe(401);
    // 다시 로그인하면 새 버전의 쿠키를 받는다
    expect((await me(app, await login(app))).authenticated).toBe(true);
  });

  it('탈퇴한 계정의 쿠키는 401', async () => {
    const { app, accounts } = setup();
    const cookie = await login(app);
    accounts.markDeleted('dev:테스터', NOW.getTime());
    expect((await post(app, chatBody(), cookie)).status).toBe(401);
  });

  it('차단한 계정은 쿠키가 무효이고 다시 로그인할 수 없다', async () => {
    const { app, accounts } = setup();
    const cookie = await login(app);
    accounts.setStatus('dev:테스터', 'banned');
    expect((await me(app, cookie)).authenticated).toBe(false);
    const res = await app.request('/api/auth/login?user=' + encodeURIComponent('테스터'));
    expect(res.headers.get('location')).toBe('/?login=blocked');
    expect(res.headers.get('set-cookie') ?? '').not.toContain('alldoc_session=ey');
  });

  it('계정 행이 없는 쿠키(서명은 맞음)는 무효다', async () => {
    const { app, db } = setup();
    const cookie = await login(app);
    db.exec('DELETE FROM users');
    expect((await me(app, cookie)).authenticated).toBe(false);
  });
});

describe('계정 API: 모든 기기 로그아웃·계정 삭제', () => {
  const me = async (app: App, cookie: string) => (await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;
  const postJson = (app: App, path: string, cookie: string | undefined, body: unknown = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

  it('모든 기기에서 로그아웃하면 이 쿠키와 다른 기기의 쿠키가 모두 무효가 된다', async () => {
    const { app } = setup();
    const a = await login(app);
    const b = await login(app); // 다른 기기
    const res = await postJson(app, '/api/account/logout-all', a);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('alldoc_session=;');
    expect((await me(app, a)).authenticated).toBe(false);
    expect((await me(app, b)).authenticated).toBe(false);
    expect((await postJson(app, '/api/account/logout-all', undefined)).status).toBe(401);
  });

  it('계정 삭제: 확인 문구가 있어야 하고, 지우면 옛 쿠키는 401, 원장은 가명, 수동 요금제는 회수, 기록은 가명으로 남는다', async () => {
    const db = openDb(':memory:');
    const ledger = new LedgerStore(db);
    const { app, accounts, entitlements, quota } = setup({}, { ledger });
    const cookie = await login(app);
    expect((await post(app, chatBody(), cookie)).status).toBe(200);
    entitlements.grant('dev:테스터', 'free', null, null, 'x', 0);
    expect((await postJson(app, '/api/account/delete', cookie, { confirm: '삭제' })).status).toBe(400);
    expect((await postJson(app, '/api/account/delete', cookie, { confirm: ACCOUNT_DELETE_CONFIRM })).status).toBe(200);
    expect(accounts.get('dev:테스터')).toMatchObject({ name: null, email: null, deletedAt: NOW.getTime() });
    expect((await post(app, chatBody(), cookie)).status).toBe(401);
    expect(db.prepare('SELECT user_id FROM ai_events').all()).toEqual([{ user_id: deletedAlias('dev:테스터', ctxSecret()) }]);
    expect(entitlements.override('dev:테스터')).toBeNull();
    // 사용 횟수는 남겨 같은 날 다시 가입해도 한도가 되돌아가지 않는다
    const again = await login(app);
    expect(quota.used('dev:테스터', '2026-10-01')).toBe(1);
    expect((await me(app, again)).authenticated).toBe(true);
  });
});

describe('약관 동의', () => {
  const me = async (app: App, cookie: string) => (await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;
  const agree = (app: App, cookie: string, body: unknown) =>
    app.request('/api/account/agree', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });

  it('약관 판이 없는 서버는 동의를 묻지 않는다', async () => {
    const { app } = setup();
    const cookie = await login(app);
    expect((await me(app, cookie)).agreement).toBeNull();
    expect((await post(app, chatBody(), cookie)).status).toBe(200);
  });

  it('약관 판이 있으면 동의 전에는 AI 가 403 이고 횟수를 쓰지 않으며, 동의하면 쓸 수 있다', async () => {
    const { app, quota } = setup({ TERMS_VERSION: '2026-10', TERMS_URL: 'https://example.com/terms', PRIVACY_URL: 'https://example.com/privacy' });
    const cookie = await login(app);
    expect((await me(app, cookie)).agreement).toEqual({ required: true, version: '2026-10', termsUrl: 'https://example.com/terms', privacyUrl: 'https://example.com/privacy' });
    const blocked = await post(app, chatBody(), cookie);
    expect(blocked.status).toBe(403);
    expect((await errorOf(blocked)).code).toBe('agreement_required');
    expect(quota.used('dev:테스터', '2026-10-01')).toBe(0);
    expect((await agree(app, cookie, { version: '2026-10' })).status).toBe(400); // 만 14세 확인 없음
    expect((await agree(app, cookie, { version: '2026-09', age14: true })).status).toBe(409); // 옛 판
    expect((await agree(app, cookie, { version: '2026-10', age14: true })).status).toBe(200);
    expect((await me(app, cookie)).agreement?.required).toBe(false);
    expect((await post(app, chatBody(), cookie)).status).toBe(200);
  });

  it('약관 판이 바뀌면 다시 동의해야 한다', async () => {
    const first = setup({ TERMS_VERSION: 'v1', TERMS_URL: 'https://example.com/t', PRIVACY_URL: 'https://example.com/p' });
    const cookie = await login(first.app);
    await agree(first.app, cookie, { version: 'v1', age14: true });
    const next = createApp({ ...first.deps, config: testConfig({ WEB_DIST: first.config.webDist, TERMS_VERSION: 'v2', TERMS_URL: 'https://example.com/t', PRIVACY_URL: 'https://example.com/p' }) });
    expect((await me(next, cookie)).agreement?.required).toBe(true);
  });
});

describe('요금제와 한도', () => {
  const lim = (over: Record<string, unknown> = {}) => ({ aiRequestsPerDay: 2, aiRequestsPerMonth: null, aiMaxDocChars: 120_000, aiCostCapMicroUsdPerMonth: null, ...over });
  const plansFile = (free: Record<string, unknown> = {}) =>
    JSON.stringify({ default: 'free', plans: [{ id: 'free', name: '무료', limits: lim(free) }, { id: 'pro', name: '프로', limits: lim({ aiRequestsPerDay: null }) }] });
  const withPlans = (free: Record<string, unknown> = {}, env: Record<string, string> = {}, over: Partial<AppDeps> = {}) => {
    const dist = mkdtempSync(join(tmpdir(), 'alldoc-web-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html>');
    const config = testConfig({ WEB_DIST: dist, PLANS_CONFIG_PATH: '/srv/plans.json', ...env }, { 'plans.json': plansFile(free) });
    const db = openDb(':memory:');
    const deps: AppDeps = {
      config,
      quota: new QuotaStore(db),
      accounts: new AccountStore(db),
      entitlements: new EntitlementStore(db, config),
      audit: new AuditLog(db),
      providers: { chat: new MockProvider(), format_check: new MockProvider(), tex_chat: new MockProvider(), tex_fix: new MockProvider() },
      now: () => NOW,
      log: () => undefined,
      ...over,
    };
    return { app: createApp(deps), deps, db };
  };
  const me = async (app: App, cookie: string) => (await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse;

  it('내 정보에 요금제와 오늘·이번 달 사용 횟수가 나온다', async () => {
    const { app } = withPlans();
    const cookie = await login(app);
    await post(app, chatBody(), cookie);
    expect(await me(app, cookie)).toMatchObject({
      quota: { limit: 2, used: 1, remaining: 1 },
      plan: { id: 'free', name: '무료', source: 'default', aiRequestsPerDay: 2 },
      usage: { aiToday: 1, aiThisMonth: 1 },
    });
  });

  it('관리자가 요금제를 수동으로 주면 한도가 오른다(하루 한도 없는 요금제는 남은 횟수를 보이지 않는다)', async () => {
    const { app, deps } = withPlans();
    const cookie = await login(app);
    for (let i = 0; i < 2; i++) expect((await post(app, chatBody(), cookie)).status).toBe(200);
    expect((await post(app, chatBody(), cookie)).status).toBe(429);
    deps.entitlements.grant('dev:테스터', 'pro', null, '베타', 'admin-cli', NOW.getTime());
    expect((await post(app, chatBody(), cookie)).status).toBe(200);
    expect(await me(app, cookie)).toMatchObject({ quota: null, plan: { id: 'pro', source: 'override' }, usage: { aiToday: 3 } });
  });

  it('월 한도를 넘으면 429 이고 하루 횟수를 쓰지 않는다', async () => {
    const { app, deps } = withPlans({ aiRequestsPerDay: 10, aiRequestsPerMonth: 3 });
    const cookie = await login(app);
    deps.quota.consume('dev:테스터', '2026-09-30', 99); // 지난달 기록은 세지 않는다
    deps.quota.consume('dev:테스터', '2026-10-01', 99);
    deps.quota.consume('dev:테스터', '2026-10-01', 99);
    expect((await post(app, chatBody(), cookie)).status).toBe(200); // 이번 달 3번째
    const res = await post(app, chatBody(), cookie);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).message).toContain('이번 달 쓸 수 있는 AI 횟수(3회)');
    expect(deps.quota.used('dev:테스터', '2026-10-01')).toBe(3);
  });

  it('요금제의 글자 상한을 넘는 문서는 413', async () => {
    const { app } = withPlans({ aiMaxDocChars: 5 });
    const cookie = await login(app);
    const res = await post(app, chatBody(), cookie); // 문서 글 "몇일 뒤에 만나요" 9자
    expect(res.status).toBe(413);
    expect((await errorOf(res)).message).toContain('5자까지');
    expect((await me(app, cookie)).maxDocChars).toBe(5);
  });

  it('사용자의 이번 달 원가가 숨은 상한에 닿으면 429', async () => {
    const db = openDb(':memory:');
    const ledger = new LedgerStore(db);
    const { app } = withPlans({ aiCostCapMicroUsdPerMonth: 100_000 }, {}, { ledger });
    const cookie = await login(app);
    const usage = { modelRequested: 'claude-opus-5-5', modelServed: 'claude-opus-5-5', fallback: false, parts: [{ model: 'claude-opus-5-5', inputTokens: 20_000, outputTokens: 3_000, cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0 }] };
    ledger.recordAi({ at: 0, day: '2026-10-01', userId: 'dev:테스터', planId: 'free', task: 'chat', provider: 'anthropic', modelRequested: 'claude-opus-5-5', usage, docChars: 1, proposals: 0, dropped: 0, ms: 1, outcome: 'ok' });
    const res = await post(app, chatBody(), cookie);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).message).toContain('이번 달 AI 사용량이 많아');
  });

  it('전체 하루 비용 상한에 닿으면 모두에게 503 이고 횟수를 쓰지 않는다', async () => {
    const db = openDb(':memory:');
    const ledger = new LedgerStore(db);
    const { app, deps } = withPlans({}, { AI_DAILY_BUDGET_USD: '0.1' }, { ledger });
    const cookie = await login(app);
    const usage = { modelRequested: 'claude-opus-5-5', modelServed: 'claude-opus-5-5', fallback: false, parts: [{ model: 'claude-opus-5-5', inputTokens: 20_000, outputTokens: 3_000, cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0 }] };
    ledger.recordAi({ at: 0, day: '2026-10-01', userId: 'g:다른 사람', planId: 'free', task: 'chat', provider: 'anthropic', modelRequested: 'claude-opus-5-5', usage, docChars: 1, proposals: 0, dropped: 0, ms: 1, outcome: 'ok' });
    const res = await post(app, chatBody(), cookie);
    expect(res.status).toBe(503);
    expect(deps.quota.used('dev:테스터', '2026-10-01')).toBe(0);
  });

  it('원장에 요청 당시 요금제를 남긴다', async () => {
    const db = openDb(':memory:');
    const { app } = withPlans({}, {}, { ledger: new LedgerStore(db) });
    await post(app, chatBody(), await login(app));
    expect(db.prepare('SELECT plan_id FROM ai_events').get()).toEqual({ plan_id: 'free' });
  });
});

describe('AI 사용량 원장 기록', () => {
  const usage = { modelRequested: 'claude-opus-5-5', modelServed: 'claude-opus-5-5', fallback: false, parts: [{ model: 'claude-opus-5-5', inputTokens: 1_000, outputTokens: 100, cacheWriteTokens: 0, cacheWrite1hTokens: 0, cacheReadTokens: 0 }] };
  const rows = (ledger: LedgerStore) => ledger.summary('2026-10-01', '2026-10-01');

  it('성공한 요청은 결과와 원가를 남긴다(데모 AI 는 모델 mock, 원가 0)', async () => {
    const ledger = new LedgerStore(openDb(':memory:'));
    const { app } = setup({}, { ledger });
    expect((await post(app, chatBody(), await login(app))).status).toBe(200);
    expect(rows(ledger)).toMatchObject([{ task: 'chat', model: 'mock', requests: 1, ok: 1, noUsage: 0, totalMicroUsd: 0 }]);
  });

  it('거절과 응답 뒤 실패도 사용량과 함께 남기고, 연결 실패는 원가를 비워 둔다', async () => {
    const ledger = new LedgerStore(openDb(':memory:'));
    const refusing: AiProvider = { id: 'anthropic', demo: false, propose: async () => { throw new ProviderRefusedError(undefined, usage); } };
    const cut: AiProvider = { id: 'anthropic', demo: false, propose: async () => { throw new ProviderFailedError('끊겼어요', undefined, usage); } };
    const down: AiProvider = { id: 'anthropic', demo: false, propose: async () => { throw new ProviderFailedError('연결하지 못했어요'); } };
    for (const p of [refusing, cut, down]) {
      const { app } = setup({}, { ledger, providers: { chat: p, format_check: p, tex_chat: p, tex_fix: p } });
      await post(app, chatBody(), await login(app));
    }
    // 4,000 + 2,000 마이크로달러씩 두 건
    expect(rows(ledger)).toMatchObject([{ model: 'claude-opus-5-5', requests: 3, ok: 0, noUsage: 1, totalMicroUsd: 12_000 }]);
  });

  it('원장 기록이 실패해도 사용자 응답은 그대로 간다', async () => {
    const closed = openDb(':memory:');
    const ledger = new LedgerStore(closed);
    closed.close(); // 닫힌 DB 에 쓰면 오류가 난다
    const log = vi.fn();
    const { app } = setup({}, { ledger, log });
    expect((await post(app, chatBody(), await login(app))).status).toBe(200);
    expect(log.mock.calls.some(([m]) => m === 'AI 원장 기록 실패')).toBe(true);
  });
});
