import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { AiRequestSchema, ERROR_CODES, isAiTarget, MAX_DOC_CHARS, type AiResponse, type MeResponse, type Quota } from '@alldoc/shared';
import { toProposals } from './ai/convert';
import type { Providers } from './ai/providers';
import { ProviderFailedError, ProviderRefusedError, type ProviderUsage } from './ai/types';
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
import type { AccountStore } from './auth/accounts';
import { monthStart, type EntitlementStore } from './billing/entitlements';
import type { Config } from './config';
import type { AiOutcome, LedgerStore } from './ledger';
import { dayKey, quotaOf, type QuotaStore } from './quota';
import { createStaticHandler } from './static';

export interface AppDeps {
  config: Config;
  quota: QuotaStore;
  accounts: AccountStore;
  entitlements: EntitlementStore;
  providers: Providers;
  /** AI 사용량 원장. 없으면 남기지 않는다(시험 등). */
  ledger?: LedgerStore;
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
  const { config, quota, accounts, entitlements, providers } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((m: string, extra?: Record<string, unknown>) => console.log(extra ? `${m} ${JSON.stringify(extra)}` : m));
  const app = new Hono();

  const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: 'Lax' as const, secure: config.secureCookies, path: '/', maxAge });
  /** 로그인한 사용자. 쿠키 서명·만료에 더해 계정이 있고, 탈퇴·차단되지 않았고, 세션 버전이 같아야 한다. */
  const userOf = (c: Context): SessionUser | null => {
    if (config.authMode === 'none') return null;
    const s = readSession(getCookie(c, SESSION_COOKIE), config.sessionSecret, now().getTime());
    if (!s) return null;
    const a = accounts.get(s.id);
    if (!a || a.deletedAt !== null || a.status !== 'active' || a.sessionVersion !== s.sv) return null;
    return { id: a.id, name: a.name, email: a.email };
  };

  /** 로그인 처리: 계정을 만들거나 갱신하고 세션 쿠키를 준다. 차단된 계정이면 false. */
  const startSession = (c: Context, user: SessionUser): boolean => {
    const a = accounts.login(user, now().getTime());
    if (a.status !== 'active') return false;
    setCookie(c, SESSION_COOKIE, newSessionToken(user, config.sessionSecret, now().getTime(), a.sessionVersion), cookieOpts(SESSION_TTL_SEC));
    return true;
  };

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
    // 로그인 전(로그인이 필요한 설치)에는 기본 요금제의 글자 상한을 알려 준다.
    const ent = entitlements.resolve(user ? user.id : config.authMode === 'none' ? null : '', now().getTime());
    const usedToday = user ? quota.used(user.id, day) : 0;
    const perDay = ent.limits.aiRequestsPerDay;
    const body: MeResponse = {
      authMode: config.authMode,
      authenticated: user !== null,
      user: user ? { name: user.name, email: user.email, picture: null } : null,
      quota: user && perDay !== null ? quotaOf(usedToday, perDay) : null,
      plan: user
        ? { id: ent.planId, name: ent.planName, source: ent.source, validUntil: ent.validUntil, aiRequestsPerDay: perDay, aiRequestsPerMonth: ent.limits.aiRequestsPerMonth }
        : null,
      usage: user ? { aiToday: usedToday, aiThisMonth: quota.usedBetween(user.id, monthStart(day), day) } : null,
      ai: {
        available: available.length > 0,
        demo: available.length > 0 && available.every((p) => p.demo),
        provider: available[0]?.id ?? 'none',
      },
      maxDocChars: ent.limits.aiMaxDocChars,
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
      if (!startSession(c, user)) return c.redirect('/?login=blocked');
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
      if (!startSession(c, user)) return c.redirect('/?login=blocked');
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

      // 요금제 → 글자 상한 → 전체 하루 비용 차단기 → (사용자) 진행 중 확인 → 월 횟수 → 월 원가 상한 → 하루 횟수 차감
      const day = dayKey(now(), config.timezone);
      const ent = entitlements.resolve(user?.id ?? null, now().getTime());
      const lim = ent.limits;
      if (chars > lim.aiMaxDocChars) {
        return fail(c, 413, ERROR_CODES.tooLarge, `문서가 너무 길어요(${chars.toLocaleString('ko-KR')}자). 지금 요금제(${ent.planName})로는 한 번에 ${lim.aiMaxDocChars.toLocaleString('ko-KR')}자까지 보낼 수 있어요.`);
      }
      if (config.aiDailyBudgetMicroUsd !== null && deps.ledger && deps.ledger.dayCost(day) >= config.aiDailyBudgetMicroUsd) {
        log('AI 전체 하루 비용 상한에 닿아 요청을 멈춤', { day, budgetMicroUsd: config.aiDailyBudgetMicroUsd });
        return fail(c, 503, ERROR_CODES.aiUnavailable, '오늘은 AI 사용량이 많아 잠시 멈췄어요. 내일 0시 뒤에 다시 시도해 주세요.');
      }
      if (user) {
        if (inflight.has(user.id)) return fail(c, 429, ERROR_CODES.busy, '이전 AI 요청을 처리하는 중이에요. 끝난 뒤에 다시 시도해 주세요.');
        const month = monthStart(day);
        if (lim.aiRequestsPerMonth !== null && quota.usedBetween(user.id, month, day) >= lim.aiRequestsPerMonth) {
          return fail(c, 429, ERROR_CODES.quotaExceeded, `이번 달 쓸 수 있는 AI 횟수(${lim.aiRequestsPerMonth}회)를 모두 사용했어요. 다음 달 1일에 다시 쓸 수 있어요.`);
        }
        if (lim.aiCostCapMicroUsdPerMonth !== null && deps.ledger && deps.ledger.userCost(user.id, month, day) >= lim.aiCostCapMicroUsdPerMonth) {
          log('사용자 월 원가 상한에 닿음', { user: user.id, plan: ent.planId });
          return fail(c, 429, ERROR_CODES.quotaExceeded, '이번 달 AI 사용량이 많아 다음 달 1일까지 AI를 쓸 수 없어요. 계속 써야 한다면 문의해 주세요.');
        }
        const r = quota.consume(user.id, day, lim.aiRequestsPerDay ?? Number.MAX_SAFE_INTEGER);
        if (!r.ok) {
          return fail(c, 429, ERROR_CODES.quotaExceeded, `오늘 쓸 수 있는 AI 횟수(${lim.aiRequestsPerDay}회)를 모두 사용했어요. 내일 0시(${config.timezone})에 다시 쓸 수 있어요.`);
        }
        inflight.add(user.id);
      }
      const quotaNow = (): Quota | null => (user && lim.aiRequestsPerDay !== null ? quotaOf(quota.used(user.id, day), lim.aiRequestsPerDay) : null);

      const started = Date.now();
      /** 원장에 한 줄 남긴다. 원장 기록이 실패해도 사용자 응답은 막지 않는다. 원가(마이크로달러)를 돌려준다. */
      const record = (outcome: AiOutcome, usage: ProviderUsage | undefined, proposals = 0, dropped = 0): number | null => {
        if (!deps.ledger) return null;
        try {
          return deps.ledger.recordAi({
            at: now().getTime(),
            day,
            userId: user?.id ?? null,
            planId: ent.planId,
            task: req.mode,
            provider: provider.id,
            modelRequested: usage?.modelRequested ?? (provider.demo ? 'mock' : config.ai[req.mode].model),
            usage,
            docChars: chars,
            proposals,
            dropped,
            ms: Date.now() - started,
            outcome,
          });
        } catch (err) {
          log('AI 원장 기록 실패', { error: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : String(err).slice(0, 500) });
          return null;
        }
      };
      const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(AI_TIMEOUT_MS)]);
      try {
        const result = await provider.propose({ request: req, signal });
        const { proposals, dropped } = toProposals(result.proposals, req.document);
        let reply = result.reply.trim() || (proposals.length > 0 ? `제안 ${proposals.length}개를 만들었어요.` : '고칠 곳을 찾지 못했어요.');
        if (dropped > 0) reply += `\n(문서와 맞지 않는 제안 ${dropped}개는 제외했어요.)`;
        const cost = record('ok', result.usage, proposals.length, dropped);
        log('AI 요청 완료', { mode: req.mode, provider: provider.id, model: result.usage?.modelServed, chars, proposals: proposals.length, dropped, costMicroUsd: cost, ms: Date.now() - started });
        const out: AiResponse = {
          reply,
          proposals,
          demo: provider.demo,
          quota: quotaNow(),
        };
        return c.json(out);
      } catch (e) {
        if (e instanceof ProviderRefusedError) {
          // 모델이 답을 거절했다: 요청은 처리되었으므로 사용 횟수는 돌려주지 않는다. 거절도 과금될 수 있어 원장에 남긴다.
          const cost = record('refused', e.usage);
          log('AI 거절', { mode: req.mode, provider: provider.id, costMicroUsd: cost });
          return fail(c, 422, ERROR_CODES.aiRefused, e.message);
        }
        if (user) quota.refund(user.id, day);
        record(signal.aborted ? 'aborted' : 'failed', e instanceof ProviderFailedError ? e.usage : undefined);
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
