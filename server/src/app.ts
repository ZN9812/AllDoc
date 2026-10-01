import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { AiRequestSchema, ERROR_CODES, isAiTarget, MAX_DOC_CHARS, type AiResponse, type MeResponse } from '@alldoc/shared';
import { toProposals } from './ai/convert';
import type { Providers } from './ai/providers';
import { ProviderFailedError, ProviderRefusedError } from './ai/types';
import { buildAuthUrl, loginWithCode } from './auth/google';
import {
  newSessionToken,
  OAUTH_COOKIE,
  OAUTH_TTL_SEC,
  open,
  pkceChallenge,
  randomToken,
  readSession,
  safeNext,
  seal,
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  type SessionUser,
} from './auth/session';
import type { Config } from './config';
import { dayKey, quotaOf, type QuotaStore } from './quota';
import { createStaticHandler } from './static';

export interface AppDeps {
  config: Config;
  quota: QuotaStore;
  providers: Providers;
  now?: () => Date;
  fetch?: typeof fetch;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

/** 요청 본문 최대 크기. 문서 글자 수 상한(MAX_DOC_CHARS)보다 넉넉하게 둔다(서식 정보 포함). */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const AI_TIMEOUT_MS = 150_000;

/**
 * 브라우저가 지켜야 하는 보안 규칙. 문서 편집기(WASM, 작업 스레드, 같은 출처 iframe)가 필요로 하는 것만 열어 둔다.
 * 개발 서버(Vite)는 이 서버를 거치지 않으므로 영향을 받지 않는다.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

function fail(c: Context, status: 400 | 401 | 403 | 404 | 413 | 422 | 429 | 500 | 502 | 503, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function createApp(deps: AppDeps): Hono {
  const { config, quota, providers } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string, extra?: Record<string, unknown>) => console.log(extra ? `${m} ${JSON.stringify(extra)}` : m));
  const app = new Hono();

  const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: 'Lax' as const, secure: config.secureCookies, path: '/', maxAge });
  const userOf = (c: Context): SessionUser | null =>
    config.authMode === 'none' ? null : readSession(getCookie(c, SESSION_COOKIE), config.sessionSecret, now().getTime());

  const securityHeaders: MiddlewareHandler = async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    if (config.secureCookies) c.header('Strict-Transport-Security', 'max-age=31536000');
  };

  // 다른 사이트에서 날아온 요청(CSRF)을 막는다: 값을 바꾸는 요청은 우리 사이트(또는 허용한 주소)에서 온 것만 받는다.
  const sameOriginOnly: MiddlewareHandler = async (c, next) => {
    const m = c.req.method;
    if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
      const origin = c.req.header('origin');
      const site = c.req.header('sec-fetch-site');
      if ((origin && !config.allowedOrigins.includes(origin)) || site === 'cross-site') {
        return fail(c, 403, ERROR_CODES.forbidden, '허용되지 않은 곳에서 온 요청이에요.');
      }
    }
    await next();
  };

  app.use('*', securityHeaders);
  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });
  app.use('/api/*', sameOriginOnly);

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ---- 내 정보 ----
  app.get('/api/me', (c) => {
    const user = userOf(c);
    const day = dayKey(now(), config.timezone);
    const available = (['chat', 'format_check'] as const).map((m) => providers[m]).filter((p): p is NonNullable<typeof p> => p !== null);
    const body: MeResponse = {
      authMode: config.authMode,
      authenticated: user !== null,
      user: user ? { name: user.name, email: user.email, picture: null } : null,
      quota: user ? quotaOf(quota.used(user.id, day), config.dailyLimit) : null,
      ai: {
        available: available.length > 0,
        demo: available.length > 0 && available.every((p) => p.demo),
        provider: available[0]?.id ?? 'none',
      },
      maxDocChars: MAX_DOC_CHARS,
    };
    return c.json(body);
  });

  // ---- 로그인 ----
  app.get('/api/auth/login', (c) => {
    const next = safeNext(c.req.query('next'));
    const nowMs = now().getTime();
    if (config.authMode === 'none') return c.redirect(next);

    if (config.authMode === 'dev') {
      const name = (c.req.query('user') ?? '개발용 사용자').trim().slice(0, 40) || '개발용 사용자';
      const user: SessionUser = { id: `dev:${name}`, name, email: null };
      setCookie(c, SESSION_COOKIE, newSessionToken(user, config.sessionSecret, nowMs), cookieOpts(SESSION_TTL_SEC));
      return c.redirect(next);
    }

    if (!config.google) return fail(c, 503, ERROR_CODES.aiUnavailable, '구글 로그인이 설정되어 있지 않아요.');
    const state = randomToken();
    const verifier = randomToken(48);
    setCookie(c, OAUTH_COOKIE, seal({ state, verifier, next }, config.sessionSecret, nowMs, OAUTH_TTL_SEC), cookieOpts(OAUTH_TTL_SEC));
    return c.redirect(buildAuthUrl(config.google, `${config.publicUrl}/api/auth/callback`, state, pkceChallenge(verifier)));
  });

  app.get('/api/auth/callback', async (c) => {
    const saved = open<{ state: string; verifier: string; next: string }>(getCookie(c, OAUTH_COOKIE), config.sessionSecret, now().getTime());
    deleteCookie(c, OAUTH_COOKIE, { path: '/' });
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (config.authMode !== 'google' || !config.google || !saved || !code || !state || state !== saved.state) return c.redirect('/?login=failed');
    try {
      const user = await loginWithCode(config.google, `${config.publicUrl}/api/auth/callback`, code, saved.verifier, deps.fetch);
      setCookie(c, SESSION_COOKIE, newSessionToken(user, config.sessionSecret, now().getTime()), cookieOpts(SESSION_TTL_SEC));
      return c.redirect(safeNext(saved.next));
    } catch (e) {
      log('구글 로그인 실패', { reason: e instanceof Error ? e.message : String(e) });
      return c.redirect('/?login=failed');
    }
  });

  app.post('/api/auth/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ---- AI 제안 ----
  const inflight = new Set<string>();

  app.post(
    '/api/ai/propose',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => fail(c, 413, ERROR_CODES.tooLarge, '문서가 너무 커서 AI에 보낼 수 없어요. 문서를 나누어 시도해 주세요.'),
    }),
    async (c) => {
      const user = userOf(c);
      if (config.authMode !== 'none' && !user) return fail(c, 401, ERROR_CODES.unauthenticated, '로그인이 필요해요.');

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail(c, 400, ERROR_CODES.badRequest, '요청을 읽지 못했어요.');
      }
      const parsed = AiRequestSchema.safeParse(body);
      if (!parsed.success) return fail(c, 400, ERROR_CODES.badRequest, '요청 형식이 올바르지 않아요.');
      const req = parsed.data;

      if (!isAiTarget(req.document.kind)) return fail(c, 400, ERROR_CODES.badRequest, 'PDF는 AI로 고칠 수 없어요.');
      if (req.mode === 'chat' && req.instruction.trim() === '') return fail(c, 400, ERROR_CODES.badRequest, 'AI에게 시킬 내용을 적어 주세요.');
      if (req.mode === 'format_check' && req.criteria === 'rules' && !req.rulesText?.trim()) {
        return fail(c, 400, ERROR_CODES.badRequest, '점검할 규칙을 적어 주세요.');
      }
      const chars = req.document.paragraphs.reduce((n, p) => n + p.text.length, 0);
      if (chars > MAX_DOC_CHARS) {
        return fail(c, 413, ERROR_CODES.tooLarge, `문서가 너무 길어요(${chars.toLocaleString('ko-KR')}자). AI는 한 번에 ${MAX_DOC_CHARS.toLocaleString('ko-KR')}자까지 볼 수 있어요.`);
      }

      const provider = providers[req.mode];
      if (!provider) return fail(c, 503, ERROR_CODES.aiUnavailable, '이 서버에는 AI가 연결되어 있지 않아요.');

      const day = dayKey(now(), config.timezone);
      if (user) {
        if (inflight.has(user.id)) return fail(c, 429, ERROR_CODES.busy, '이전 AI 요청을 처리하는 중이에요. 끝난 뒤에 다시 시도해 주세요.');
        const r = quota.consume(user.id, day, config.dailyLimit);
        if (!r.ok) {
          return fail(c, 429, ERROR_CODES.quotaExceeded, `오늘 쓸 수 있는 AI 횟수(${config.dailyLimit}회)를 모두 사용했어요. 내일 0시(${config.timezone})에 다시 쓸 수 있어요.`);
        }
        inflight.add(user.id);
      }

      const started = Date.now();
      try {
        const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(AI_TIMEOUT_MS)]);
        const result = await provider.propose({ request: req, signal });
        const { proposals, dropped } = toProposals(result.proposals, req.document);
        let reply = result.reply.trim() || (proposals.length > 0 ? `제안 ${proposals.length}개를 만들었어요.` : '고칠 곳을 찾지 못했어요.');
        if (dropped > 0) reply += `\n(문서와 맞지 않는 제안 ${dropped}개는 제외했어요.)`;
        log('AI 요청 완료', { mode: req.mode, provider: provider.id, chars, proposals: proposals.length, dropped, ms: Date.now() - started });
        const out: AiResponse = {
          reply,
          proposals,
          demo: provider.demo,
          quota: user ? quotaOf(quota.used(user.id, day), config.dailyLimit) : null,
        };
        return c.json(out);
      } catch (e) {
        if (e instanceof ProviderRefusedError) {
          // 모델이 답을 거절했다: 요청은 처리되었으므로 사용 횟수는 돌려주지 않는다.
          log('AI 거절', { mode: req.mode, provider: provider.id });
          return fail(c, 422, ERROR_CODES.aiRefused, e.message);
        }
        if (user) quota.refund(user.id, day);
        const cause = e instanceof ProviderFailedError ? e.cause : e;
        log('AI 요청 실패', { mode: req.mode, provider: provider.id, ms: Date.now() - started, error: cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 500) : String(cause).slice(0, 500) });
        if (c.req.raw.signal.aborted) return fail(c, 400, ERROR_CODES.badRequest, '요청이 취소되었어요.');
        return fail(c, 502, ERROR_CODES.aiFailed, e instanceof ProviderFailedError ? e.message : 'AI 요청을 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.');
      } finally {
        if (user) inflight.delete(user.id);
      }
    },
  );

  app.all('/api/*', (c) => fail(c, 404, 'not_found', '찾을 수 없는 요청이에요.'));

  // ---- 웹 앱 ----
  app.use('*', compress());
  app.get('*', createStaticHandler(config.webDist));
  app.all('*', (c) => c.text('Method Not Allowed', 405));

  app.onError((err, c) => {
    log('서버 오류', { path: new URL(c.req.url).pathname, error: `${err.name}: ${err.message}`.slice(0, 500) });
    return fail(c, 500, ERROR_CODES.internal, '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.');
  });

  return app;
}
