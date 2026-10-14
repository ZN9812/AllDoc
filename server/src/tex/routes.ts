// LaTeX 컴파일 API(docs/LATEX.md "API"). 본 서버는 인증·약관·한도·파일 확인과 대기열을 맡고, 컴파일은 CompilerClient 뒤의 일꾼이 한다.
//   POST /api/tex/blobs/check   이 사용자가 아직 올리지 않은 해시만 돌려준다
//   PUT  /api/tex/blobs/:hash   파일 바이트를 받는다(해시를 서버에서 다시 확인)
//   POST /api/tex/compile       컴파일(사용자당 동시 1개, 서버 전체 동시 수·대기열 상한)
//   GET  /api/tex/output/:id.pdf 만든 PDF(만든 사람만)
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import {
  BlobCheckRequestSchema,
  CompileRequestSchema,
  ERROR_CODES,
  isTexSource,
  parseTexLog,
  SHA256_HEX,
  type BlobCheckResponse,
  type CompileInfo,
  type CompileResponse,
  type CompileStatus,
} from '@alldoc/shared';
import type { SessionUser } from '../auth/session';
import type { EntitlementStore, Entitlements } from '../billing/entitlements';
import type { Config } from '../config';
import type { CompileOutcome, LedgerStore } from '../ledger';
import { dayKey } from '../quota';
import { CompilerFailedError, type CompilerClient, type CompileResult } from './client';
import { ANONYMOUS_SCOPE, sha256Hex, type TexStore } from './store';

/** 돌려주는 로그 끝부분의 상한(일꾼도 같은 값으로 자른다) */
export const MAX_LOG_BYTES = 2 * 1024 * 1024;
/** 받는 PDF 의 상한 */
export const MAX_PDF_BYTES = 200 * 1024 * 1024;
/** 대기열이 꽉 찼을 때 다시 시도하라고 알리는 시간(초) */
const RETRY_AFTER_SEC = 10;
/** 일꾼이 시간 제한 뒤 정리하고 답할 여유 */
const NETWORK_GRACE_MS = 30_000;

export interface TexRouteDeps {
  config: Config;
  compiler: CompilerClient | undefined;
  store: TexStore | undefined;
  ledger: LedgerStore | undefined;
  entitlements: EntitlementStore;
  userOf(c: Context): SessionUser | null;
  needsAgreement(userId: string): boolean;
  now(): Date;
  log(message: string, extra?: Record<string, unknown>): void;
}

type Fail = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503, code: string, message: string, extra?: Record<string, unknown>) => Response;

const fail: Fail = (c, status, code, message, extra) => c.json({ error: { code, message }, ...extra }, status);

/** 서버 전체 동시 컴파일 수와 대기열 */
export class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly concurrency: number,
    private readonly queue: number,
  ) {}

  /** 자리가 나면 풀어 줄 함수를, 대기열이 꽉 찼으면 null 을 돌려준다. */
  async acquire(): Promise<(() => void) | null> {
    if (this.active < this.concurrency) {
      this.active++;
      return this.releaser();
    }
    if (this.waiting.length >= this.queue) return null;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    return this.releaser();
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active--;
      this.waiting.shift()?.();
    };
  }

  get stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.waiting.length };
  }
}

/** 본문을 max 바이트까지만 읽는다. 넘으면 null(끝까지 읽지 않는다). */
async function readLimited(req: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(req.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const ch of chunks) {
    out.set(ch, at);
    at += ch.byteLength;
  }
  return out;
}

/** 끝부분만 남긴다(UTF-8 글자가 잘리지 않게 글자 단위로) */
function tail(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s) <= maxBytes) return s;
  let t = s.slice(-maxBytes);
  while (Buffer.byteLength(t) > maxBytes) t = t.slice(1024);
  return `…(앞부분 생략)\n${t}`;
}

/** /api/me 의 컴파일 정보. planUserId 는 요금제를 고를 사용자(로그인 전이면 '' = 기본 요금제, 로그인 없는 설치면 null), withUsage 는 오늘 쓴 횟수를 셀지 */
export function compileInfo(d: TexRouteDeps, planUserId: string | null, withUsage: boolean): CompileInfo | null {
  if (!d.config.compiler || !d.compiler || !d.store) return null;
  const ent = d.entitlements.resolve(planUserId, d.now().getTime());
  const used = withUsage && planUserId !== null && d.ledger ? d.ledger.compileUsage(planUserId, dayKey(d.now(), d.config.timezone)).count : null;
  return {
    demo: d.compiler.demo,
    retentionDays: d.config.compiler.retentionDays,
    timeoutSec: ent.limits.compileTimeoutSec,
    projectMaxBytes: ent.limits.projectMaxBytes,
    compilesPerDay: ent.limits.compilesPerDay,
    compilesToday: used,
  };
}

export function registerTexRoutes(app: Hono, d: TexRouteDeps): void {
  const limiter = new Limiter(d.config.compiler?.concurrency ?? 1, d.config.compiler?.queue ?? 0);
  const inflight = new Set<string>();
  /** 사용자별: 마지막 컴파일 뒤 새로 올린 바이트(원장의 uploaded_bytes) */
  const uploaded = new Map<string, number>();
  /** 마지막으로 본 TeX Live 판(결과 캐시 키에 넣는다) */
  let texlive = '';

  /** 공통 확인: 컴파일이 켜져 있고, 로그인했고, 약관에 동의했는지. 통과하면 사용자 칸과 권한을 돌려준다. */
  const gate = (c: Context): { scope: string; userId: string | null; ent: Entitlements; compiler: CompilerClient; store: TexStore } | Response => {
    const { compiler, store } = d;
    if (!d.config.compiler || !compiler || !store) return fail(c, 503, ERROR_CODES.compileUnavailable, '이 서버에는 LaTeX 컴파일이 연결되어 있지 않아요.');
    const user = d.userOf(c);
    if (d.config.authMode !== 'none' && !user) return fail(c, 401, ERROR_CODES.unauthenticated, '로그인이 필요해요.');
    if (user && d.needsAgreement(user.id)) return fail(c, 403, ERROR_CODES.agreementRequired, '이용약관에 동의한 뒤에 컴파일할 수 있어요.');
    const userId = user?.id ?? null;
    return { scope: userId ?? ANONYMOUS_SCOPE, userId, ent: d.entitlements.resolve(userId, d.now().getTime()), compiler, store };
  };

  app.post('/api/tex/blobs/check', async (c) => {
    const g = gate(c);
    if (g instanceof Response) return g;
    const parsed = BlobCheckRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, ERROR_CODES.badRequest, '요청 형식이 올바르지 않아요.');
    const body: BlobCheckResponse = { missing: g.store.missing(g.scope, parsed.data.hashes) };
    return c.json(body);
  });

  app.put('/api/tex/blobs/:hash', async (c) => {
    const g = gate(c);
    if (g instanceof Response) return g;
    const hash = c.req.param('hash');
    if (!SHA256_HEX.test(hash)) return fail(c, 400, ERROR_CODES.badRequest, '파일 해시 형식이 올바르지 않아요.');
    const max = g.ent.limits.projectMaxBytes;
    const bytes = await readLimited(c.req.raw, max);
    if (!bytes) return fail(c, 413, ERROR_CODES.tooLarge, `파일이 너무 커요. 지금 요금제(${g.ent.planName})로는 프로젝트 전체가 ${Math.floor(max / 1024 / 1024)}MB 이하여야 해요.`);
    if (!g.store.put(g.scope, hash, bytes, d.now().getTime())) return fail(c, 400, ERROR_CODES.badRequest, '받은 파일이 해시와 맞지 않아요. 다시 시도해 주세요.');
    uploaded.set(g.scope, (uploaded.get(g.scope) ?? 0) + bytes.byteLength);
    return c.json({ ok: true });
  });

  app.post('/api/tex/compile', async (c) => {
    const g = gate(c);
    if (g instanceof Response) return g;
    const parsed = CompileRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, ERROR_CODES.badRequest, '컴파일 요청 형식이 올바르지 않아요.');
    const req = parsed.data;
    const lim = g.ent.limits;
    const nowMs = d.now().getTime();
    const day = dayKey(d.now(), d.config.timezone);
    const paths = new Set(req.files.map((f) => f.path));
    if (paths.size !== req.files.length) return fail(c, 400, ERROR_CODES.badRequest, '같은 경로의 파일이 두 번 들어 있어요.');
    if (!paths.has(req.main) || !isTexSource(req.main)) return fail(c, 400, ERROR_CODES.badRequest, '주 파일(.tex)이 프로젝트에 없어요.');
    const projectBytes = req.files.reduce((n, f) => n + f.size, 0);

    const record = (outcome: CompileOutcome, wallMs: number, extra: { pdfBytes?: number | null; texlive?: string | null } = {}) => {
      if (!d.ledger) return;
      try {
        d.ledger.recordCompile({
          at: nowMs,
          day,
          userId: g.userId,
          planId: g.ent.planId,
          engine: req.engine,
          wallMs,
          outcome,
          projectBytes,
          files: req.files.length,
          uploadedBytes: uploaded.get(g.scope) ?? 0,
          pdfBytes: extra.pdfBytes ?? null,
          texlive: extra.texlive ?? null,
        });
        uploaded.delete(g.scope);
      } catch (err) {
        d.log('컴파일 원장 기록 실패', { error: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
      }
    };

    if (projectBytes > lim.projectMaxBytes) {
      record('too_large', 0);
      return fail(c, 413, ERROR_CODES.tooLarge, `프로젝트가 너무 커요(${(projectBytes / 1024 / 1024).toFixed(1)}MB). 지금 요금제(${g.ent.planName})로는 ${Math.floor(lim.projectMaxBytes / 1024 / 1024)}MB 까지 컴파일할 수 있어요.`);
    }
    const missing = req.files.filter((f) => !g.store.owns(g.scope, f.hash)).map((f) => f.hash);
    if (missing.length > 0) return fail(c, 409, ERROR_CODES.blobsMissing, '서버에 없는 파일이 있어요. 다시 올린 뒤 컴파일해 주세요.', { missing: [...new Set(missing)] });

    // 같은 파일·엔진·주 파일로 한 시간 안에 만든 결과가 있으면 그대로 돌려준다(횟수에 세지 않는다).
    const sorted = [...req.files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => [f.path, f.hash]);
    const cacheKey = (tl: string) => sha256Hex(new TextEncoder().encode(JSON.stringify([d.compiler?.id, tl, req.engine, req.main, sorted])));
    const hit = g.store.cached(g.scope, cacheKey(texlive), nowMs);
    if (hit) {
      record('cached', 0);
      const out: CompileResponse = { jobId: hit, status: 'ok', diagnostics: [], logTail: '이전에 같은 파일로 만든 PDF를 다시 보여 줘요.', pdfUrl: `/api/tex/output/${hit}.pdf`, ms: 0, cached: true };
      return c.json(out);
    }

    if (g.userId !== null && d.ledger) {
      const used = d.ledger.compileUsage(g.userId, day);
      if (lim.compilesPerDay !== null && used.count >= lim.compilesPerDay) {
        return fail(c, 429, ERROR_CODES.quotaExceeded, `오늘 컴파일할 수 있는 횟수(${lim.compilesPerDay}회)를 모두 사용했어요. 내일 0시(${d.config.timezone})에 다시 쓸 수 있어요.`);
      }
      if (lim.compileSecondsPerDay !== null && used.ms >= lim.compileSecondsPerDay * 1000) {
        return fail(c, 429, ERROR_CODES.quotaExceeded, `오늘 쓸 수 있는 컴파일 시간(${lim.compileSecondsPerDay}초)을 모두 사용했어요. 내일 0시(${d.config.timezone})에 다시 쓸 수 있어요.`);
      }
    }
    if (inflight.has(g.scope)) return fail(c, 429, ERROR_CODES.busy, '이전 컴파일이 아직 끝나지 않았어요. 끝난 뒤에 다시 시도해 주세요.');
    inflight.add(g.scope);
    let release: (() => void) | null = null;
    try {
      release = await limiter.acquire();
      if (!release) {
        record('busy', 0);
        c.header('Retry-After', String(RETRY_AFTER_SEC));
        return fail(c, 503, ERROR_CODES.busy, `지금은 컴파일하려는 사람이 많아요. ${RETRY_AFTER_SEC}초 뒤에 다시 시도해 주세요.`);
      }
      const files: Array<{ path: string; bytes: Uint8Array }> = [];
      for (const f of req.files) {
        const bytes = g.store.read(g.scope, f.hash, nowMs);
        if (!bytes) return fail(c, 409, ERROR_CODES.blobsMissing, '서버에 없는 파일이 있어요. 다시 올린 뒤 컴파일해 주세요.', { missing: [f.hash] });
        files.push({ path: f.path, bytes });
      }
      const jobId = randomUUID();
      const started = Date.now();
      let result: CompileResult;
      try {
        const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(lim.compileTimeoutSec * 1000 + NETWORK_GRACE_MS)]);
        result = await g.compiler.compile({ jobId, engine: req.engine, main: req.main, files, timeoutSec: lim.compileTimeoutSec }, signal);
      } catch (e) {
        record('failed', Date.now() - started);
        const cause = e instanceof CompilerFailedError ? (e.cause ?? e) : e;
        d.log('컴파일 실패', { error: cause instanceof Error ? `${cause.name}: ${cause.message}`.slice(0, 300) : String(cause).slice(0, 300) });
        return fail(c, 502, ERROR_CODES.compileFailed, e instanceof CompilerFailedError ? e.message : '컴파일 서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.');
      }
      if (result.texlive) texlive = result.texlive;
      let status: CompileStatus = result.status;
      let pdf = result.pdf;
      if (pdf && pdf.byteLength > MAX_PDF_BYTES) {
        status = 'too_large';
        pdf = null;
      }
      if (status === 'ok' && !pdf) status = 'error';
      if (status === 'ok' && pdf) {
        g.store.saveOutput(jobId, g.scope, pdf, nowMs);
        g.store.remember(g.scope, cacheKey(result.texlive), jobId);
      }
      const ms = Date.now() - started;
      record(status, result.wallMs || ms, {
        pdfBytes: pdf?.byteLength ?? null,
        texlive: result.texlive || null,
      });
      d.log('컴파일 완료', { engine: req.engine, status, files: req.files.length, projectBytes, wallMs: result.wallMs, ms });
      const logTail = tail(result.log, MAX_LOG_BYTES);
      const out: CompileResponse = {
        jobId,
        status,
        diagnostics: parseTexLog(logTail),
        logTail,
        pdfUrl: status === 'ok' ? `/api/tex/output/${jobId}.pdf` : null,
        ms,
        cached: false,
      };
      return c.json(out);
    } finally {
      release?.();
      inflight.delete(g.scope);
    }
  });

  app.get('/api/tex/output/:name', (c) => {
    const g = gate(c);
    if (g instanceof Response) return g;
    const m = /^([0-9a-f-]{36})\.pdf$/.exec(c.req.param('name'));
    const pdf = m ? g.store.readOutput(m[1] as string, g.scope, d.now().getTime()) : null;
    if (!pdf) return fail(c, 404, 'not_found', 'PDF를 찾을 수 없어요. 다시 컴파일해 주세요.');
    return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline', 'cache-control': 'no-store' } });
  });
}
