import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_COMPILE_LIMITS, type CompileRequest, type CompileResponse, type ErrorResponse, type MeResponse } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDeps } from '../app';
import { MockProvider } from '../ai/mock';
import { AuditLog } from '../audit';
import { AccountStore } from '../auth/accounts';
import { EntitlementStore } from '../billing/entitlements';
import { openDb } from '../db';
import { LedgerStore } from '../ledger';
import { QuotaStore } from '../quota';
import { testConfig } from '../test-support/helpers';
import { MockCompilerClient, type CompilerClient } from './client';
import { Limiter } from './routes';
import { TexStore } from './store';

const NOW = new Date('2026-10-14T03:00:00Z');
const enc = new TextEncoder();
const hashOf = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const plans = (limits: Record<string, unknown> = {}) =>
  JSON.stringify({
    default: 'free',
    plans: [{ id: 'free', name: '무료', limits: { aiRequestsPerDay: 3, aiRequestsPerMonth: null, aiMaxDocChars: 120_000, aiCostCapMicroUsdPerMonth: null, ...limits } }],
  });

/** 손으로 풀어 주는 잠(동시 실행 시험용) */
function manualSleep() {
  const waiters: Array<() => void> = [];
  return {
    sleep: (_ms: number, _signal: AbortSignal) => new Promise<void>((r) => waiters.push(r)),
    releaseAll: () => waiters.splice(0).forEach((r) => r()),
    get count() {
      return waiters.length;
    },
  };
}

function setup(env: Record<string, string> = {}, opts: { limits?: Record<string, unknown>; compiler?: CompilerClient | null } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'alldoc-tex-'));
  const config = testConfig({ COMPILER: 'mock', DATA_DIR: dataDir, ...(opts.limits ? { PLANS_CONFIG_PATH: 'plans.json' } : {}), ...env }, opts.limits ? { 'plans.json': plans(opts.limits) } : {});
  const db = openDb(':memory:');
  const accounts = new AccountStore(db);
  const entitlements = new EntitlementStore(db, config);
  const ledger = new LedgerStore(db);
  const tex = new TexStore(db, dataDir);
  const provider = new MockProvider();
  const deps: AppDeps = {
    config,
    quota: new QuotaStore(db),
    accounts,
    entitlements,
    audit: new AuditLog(db),
    providers: { chat: provider, format_check: provider },
    ledger,
    compiler: opts.compiler === null ? undefined : (opts.compiler ?? new MockCompilerClient(async () => undefined)),
    tex,
    now: () => NOW,
    log: () => undefined,
  };
  return { app: createApp(deps), db, ledger, tex, dataDir, accounts, deps };
}

type App = ReturnType<typeof setup>['app'];

async function login(app: App, user = '테스터'): Promise<string> {
  const res = await app.request(`/api/auth/login?user=${encodeURIComponent(user)}&next=/`);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] as string;
}

const json = (app: App, path: string, body: unknown, cookie?: string) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

const upload = (app: App, bytes: Uint8Array, cookie?: string, hash = hashOf(bytes)) =>
  app.request(`/api/tex/blobs/${hash}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream', ...(cookie ? { cookie } : {}) }, body: bytes });

/** 파일을 올리고 컴파일 요청 본문을 만든다 */
async function project(app: App, cookie: string | undefined, files: Record<string, string>, main = 'main.tex'): Promise<CompileRequest> {
  const list = [];
  for (const [path, text] of Object.entries(files)) {
    const bytes = enc.encode(text);
    expect((await upload(app, bytes, cookie)).status).toBe(200);
    list.push({ path, hash: hashOf(bytes), size: bytes.byteLength });
  }
  return { engine: 'xelatex', main, files: list };
}

const DOC = '\\documentclass{article}\n\\begin{document}\n안녕\n\\end{document}\n';
const errorOf = async (res: Response) => ((await res.json()) as ErrorResponse).error;

describe('LaTeX 컴파일 API: 연결과 권한', () => {
  it('COMPILER=off 면 me.compile 이 null 이고 API 는 503', async () => {
    const { app } = setup({ COMPILER: 'off' });
    const cookie = await login(app);
    expect(((await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse).compile).toBeNull();
    const res = await json(app, '/api/tex/blobs/check', { hashes: [] }, cookie);
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('compile_unavailable');
  });

  it('me.compile 은 데모 여부·보관 날 수·요금제 한도·오늘 횟수를 알려 준다', async () => {
    const { app } = setup({ TEX_RETENTION_DAYS: '5' }, { limits: { compilesPerDay: 20, compileTimeoutSec: 30 } });
    expect(((await (await app.request('/api/me')).json()) as MeResponse).compile).toMatchObject({ demo: true, retentionDays: 5, timeoutSec: 30, compilesPerDay: 20, compilesToday: null });
    const cookie = await login(app);
    expect(((await (await app.request('/api/me', { headers: { cookie } })).json()) as MeResponse).compile).toMatchObject({ compilesToday: 0, projectMaxBytes: DEFAULT_COMPILE_LIMITS.projectMaxBytes });
  });

  it('로그인이 필요한 설치에서 로그인하지 않으면 401, 약관에 동의하지 않았으면 403', async () => {
    const { app } = setup({ TERMS_VERSION: 'v1', TERMS_URL: 'https://example.com/t', PRIVACY_URL: 'https://example.com/p' });
    expect((await json(app, '/api/tex/blobs/check', { hashes: [] })).status).toBe(401);
    const cookie = await login(app);
    const res = await json(app, '/api/tex/blobs/check', { hashes: [] }, cookie);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe('agreement_required');
  });

  it('로그인 없는 설치(AUTH_MODE=none)는 로그인 없이 컴파일한다', async () => {
    const { app } = setup({ AUTH_MODE: 'none', SESSION_SECRET: '' });
    const req = await project(app, undefined, { 'main.tex': DOC });
    const out = (await (await json(app, '/api/tex/compile', req)).json()) as CompileResponse;
    expect(out.status).toBe('ok');
    expect((await app.request(out.pdfUrl as string)).status).toBe(200);
  });
});

describe('LaTeX 컴파일 API: 파일 올리기와 해시 대조', () => {
  it('해시 대조는 이 사용자가 올린 것만 "있음"으로 친다(다른 사람이 같은 파일을 올렸는지 알 수 없다)', async () => {
    const { app } = setup();
    const a = await login(app, 'a');
    const b = await login(app, 'b');
    const bytes = enc.encode(DOC);
    const h = hashOf(bytes);
    expect(await (await json(app, '/api/tex/blobs/check', { hashes: [h, h] }, a)).json()).toEqual({ missing: [h] });
    expect((await upload(app, bytes, a)).status).toBe(200);
    expect(await (await json(app, '/api/tex/blobs/check', { hashes: [h] }, a)).json()).toEqual({ missing: [] });
    expect(await (await json(app, '/api/tex/blobs/check', { hashes: [h] }, b)).json()).toEqual({ missing: [h] });
  });

  it('해시와 다른 바이트, 해시 형식이 아닌 이름은 받지 않는다', async () => {
    const { app } = setup();
    const cookie = await login(app);
    expect((await upload(app, enc.encode('a'), cookie, hashOf(enc.encode('b')))).status).toBe(400);
    expect((await upload(app, enc.encode('a'), cookie, '..%2F..%2Fetc')).status).toBe(400);
  });

  it('요금제의 프로젝트 크기를 넘는 파일은 413', async () => {
    const { app } = setup({}, { limits: { projectMaxBytes: 10 } });
    const cookie = await login(app);
    const res = await upload(app, enc.encode('x'.repeat(11)), cookie);
    expect(res.status).toBe(413);
    expect((await upload(app, enc.encode('x'.repeat(10)), cookie)).status).toBe(200);
  });

  it('다른 사람이 올린 파일의 해시로는 컴파일할 수 없다(409 blobs_missing)', async () => {
    const { app } = setup();
    const a = await login(app, 'a');
    const b = await login(app, 'b');
    const req = await project(app, a, { 'main.tex': DOC });
    const res = await json(app, '/api/tex/compile', req, b);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string }; missing: string[] };
    expect(body.error.code).toBe('blobs_missing');
    expect(body.missing).toEqual([req.files[0]?.hash]);
  });
});

describe('LaTeX 컴파일 API: 컴파일', () => {
  it('성공하면 PDF 주소를 주고, PDF는 만든 사람만 받는다', async () => {
    const { app } = setup();
    const a = await login(app, 'a');
    const b = await login(app, 'b');
    const req = await project(app, a, { 'main.tex': DOC });
    const out = (await (await json(app, '/api/tex/compile', req, a)).json()) as CompileResponse;
    expect(out).toMatchObject({ status: 'ok', cached: false, diagnostics: [] });
    const pdf = await app.request(out.pdfUrl as string, { headers: { cookie: a } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('cache-control')).toBe('no-store');
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
    expect((await app.request(out.pdfUrl as string, { headers: { cookie: b } })).status).toBe(404);
    expect((await app.request('/api/tex/output/../../etc/passwd', { headers: { cookie: a } })).status).toBe(404);
  });

  it('TeX 오류는 파일·줄이 달린 진단으로 돌려주고 PDF는 없다', async () => {
    const { app } = setup();
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': DOC.replace('안녕', '\\input{ch/1}'), 'ch/1.tex': '첫 줄\n\\begin{itemise}\n\\end{itemise}\n' });
    const out = (await (await json(app, '/api/tex/compile', req, cookie)).json()) as CompileResponse;
    expect(out.status).toBe('error');
    expect(out.pdfUrl).toBeNull();
    expect(out.diagnostics).toEqual([{ severity: 'error', file: 'ch/1.tex', line: 2, message: 'LaTeX Error: Environment itemise undefined.' }]);
    expect(out.logTail).toContain('./ch/1.tex:2:');
  });

  it('밖으로 나가는 경로, 주 파일이 없는 요청, 같은 경로 두 번은 400', async () => {
    const { app } = setup();
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': DOC });
    const file = req.files[0]!;
    expect((await json(app, '/api/tex/compile', { ...req, files: [{ ...file, path: '../main.tex' }] }, cookie)).status).toBe(400);
    expect((await json(app, '/api/tex/compile', { ...req, main: 'other.tex' }, cookie)).status).toBe(400);
    expect((await json(app, '/api/tex/compile', { ...req, main: 'main.bib', files: [{ ...file, path: 'main.bib' }] }, cookie)).status).toBe(400);
    expect((await json(app, '/api/tex/compile', { ...req, files: [file, file] }, cookie)).status).toBe(400);
  });

  it('프로젝트 전체 크기가 요금제를 넘으면 413 이고 원장에 too_large 로 남는다', async () => {
    const { app, db } = setup({}, { limits: { projectMaxBytes: 100 } });
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': DOC, 'b.tex': 'x'.repeat(60) });
    const res = await json(app, '/api/tex/compile', req, cookie);
    expect(res.status).toBe(413);
    expect(db.prepare('SELECT outcome FROM compile_events').all()).toEqual([{ outcome: 'too_large' }]);
  });

  it('시간 제한을 넘으면 timeout', async () => {
    const { app } = setup({}, { limits: { compileTimeoutSec: 2 } });
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': `% mock:sleep=5\n${DOC}` });
    const out = (await (await json(app, '/api/tex/compile', req, cookie)).json()) as CompileResponse;
    expect(out.status).toBe('timeout');
  });

  it('같은 파일로 다시 컴파일하면 저장해 둔 결과를 돌려주고 하루 횟수에 세지 않는다', async () => {
    const { app, db } = setup({}, { limits: { compilesPerDay: 1 } });
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': DOC });
    const first = (await (await json(app, '/api/tex/compile', req, cookie)).json()) as CompileResponse;
    const again = (await (await json(app, '/api/tex/compile', req, cookie)).json()) as CompileResponse;
    expect(again).toMatchObject({ cached: true, jobId: first.jobId, pdfUrl: first.pdfUrl });
    // 파일을 바꾸면 새로 컴파일해야 하는데, 하루 1회를 이미 썼다.
    const changed = await project(app, cookie, { 'main.tex': `${DOC}%` });
    const res = await json(app, '/api/tex/compile', changed, cookie);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).message).toContain('1회');
    expect(db.prepare('SELECT outcome FROM compile_events ORDER BY id').all()).toEqual([{ outcome: 'ok' }, { outcome: 'cached' }]);
  });

  it('하루 컴파일 시간 합 한도를 넘으면 429', async () => {
    const { app, ledger } = setup({}, { limits: { compileSecondsPerDay: 10 } });
    const cookie = await login(app);
    ledger.recordCompile({ at: NOW.getTime(), day: '2026-10-14', userId: 'dev:테스터', planId: 'free', engine: 'xelatex', wallMs: 10_000, outcome: 'ok', projectBytes: 1, files: 1, uploadedBytes: 0, pdfBytes: 1, texlive: 'mock' });
    const req = await project(app, cookie, { 'main.tex': DOC });
    const res = await json(app, '/api/tex/compile', req, cookie);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).message).toContain('10초');
  });
});

describe('LaTeX 컴파일 API: 동시 실행과 대기열', () => {
  it('같은 사용자는 한 번에 하나만 컴파일한다(429 busy)', async () => {
    const s = manualSleep();
    const { app } = setup({}, { compiler: new MockCompilerClient(s.sleep) });
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': `% mock:sleep=1\n${DOC}` });
    const first = json(app, '/api/tex/compile', req, cookie);
    await expect.poll(() => s.count).toBe(1);
    const second = await json(app, '/api/tex/compile', req, cookie);
    expect(second.status).toBe(429);
    expect((await errorOf(second)).code).toBe('busy');
    s.releaseAll();
    expect((await first).status).toBe(200);
    // 끝난 뒤에는 다시 할 수 있다(이번에는 캐시).
    expect((await json(app, '/api/tex/compile', req, cookie)).status).toBe(200);
  });

  it('서버 전체 동시 수와 대기열이 꽉 차면 503 과 Retry-After', async () => {
    const s = manualSleep();
    const { app, db } = setup({ COMPILER_CONCURRENCY: '1', COMPILER_QUEUE: '1' }, { compiler: new MockCompilerClient(s.sleep) });
    const users = await Promise.all(['a', 'b', 'c'].map((u) => login(app, u)));
    const reqs = await Promise.all(users.map((u, i) => project(app, u, { 'main.tex': `% mock:sleep=1\n${DOC}${'%'.repeat(i)}` })));
    const running = json(app, '/api/tex/compile', reqs[0], users[0]);
    await expect.poll(() => s.count).toBe(1);
    const waiting = json(app, '/api/tex/compile', reqs[1], users[1]);
    await new Promise((r) => setTimeout(r, 20));
    const rejected = await json(app, '/api/tex/compile', reqs[2], users[2]);
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get('retry-after')).toBe('10');
    s.releaseAll();
    expect((await running).status).toBe(200);
    await expect.poll(() => s.count).toBe(1);
    s.releaseAll();
    expect((await waiting).status).toBe(200);
    expect((db.prepare('SELECT outcome FROM compile_events ORDER BY id').all() as Array<{ outcome: string }>).map((r) => r.outcome).sort()).toEqual(['busy', 'ok', 'ok']);
  });

  it('대기열은 차례대로 자리를 넘긴다', async () => {
    const l = new Limiter(1, 2);
    const r1 = await l.acquire();
    const p2 = l.acquire();
    const p3 = l.acquire();
    expect(await l.acquire()).toBeNull();
    expect(l.stats).toEqual({ active: 1, waiting: 2 });
    r1?.();
    r1?.(); // 두 번 풀어도 한 번만 센다
    const r2 = await p2;
    expect(l.stats).toEqual({ active: 1, waiting: 1 });
    r2?.();
    (await p3)?.();
    expect(l.stats).toEqual({ active: 0, waiting: 0 });
  });
});

describe('LaTeX 컴파일: 원장·탈퇴·보관', () => {
  it('원장에는 숫자만 남고(파일 이름·내용 없음), 탈퇴하면 가명이 되며 올린 파일 기록이 지워진다', async () => {
    const { app, db } = setup();
    const cookie = await login(app);
    const req = await project(app, cookie, { 'main.tex': DOC });
    await json(app, '/api/tex/compile', req, cookie);
    const row = db.prepare('SELECT * FROM compile_events').get() as Record<string, unknown>;
    expect(row).toMatchObject({ user_id: 'dev:테스터', plan_id: 'free', engine: 'xelatex', outcome: 'ok', files: 1, project_bytes: req.files[0]?.size, uploaded_bytes: req.files[0]?.size, texlive: 'mock' });
    expect(JSON.stringify(row)).not.toContain('main.tex');
    expect((await json(app, '/api/account/delete', { confirm: '계정 삭제' }, cookie)).status).toBe(200);
    expect((db.prepare('SELECT user_id FROM compile_events').get() as { user_id: string }).user_id).toMatch(/^del:/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM user_blobs').get()).toEqual({ n: 0 });
  });

  it('마지막 사용 뒤 보관 기간이 지나면 올린 파일을 지우고, 아직 쓰는 사람이 있으면 남긴다', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'alldoc-tex-'));
    const store = new TexStore(openDb(':memory:'), dataDir);
    const bytes = enc.encode(DOC);
    const h = hashOf(bytes);
    const day = 86_400_000;
    store.put('a', h, bytes, 0);
    store.put('b', h, bytes, 5 * day);
    store.prune(8 * day, 7);
    expect(store.owns('a', h)).toBe(false);
    expect(store.owns('b', h)).toBe(true);
    store.prune(12 * day, 7);
    expect(store.owns('b', h)).toBe(true);
    store.prune(12 * day + 1, 7);
    expect(store.owns('b', h)).toBe(false);
    expect(readdirSync(join(dataDir, 'tex', 'blobs', h.slice(0, 2)))).toEqual([]);
  });

  it('만든 PDF는 한 시간 뒤 지운다', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'alldoc-tex-'));
    const store = new TexStore(openDb(':memory:'), dataDir);
    const id = '00000000-0000-4000-8000-000000000000';
    store.saveOutput(id, 'a', enc.encode('%PDF-1.4'), 0);
    expect(store.readOutput(id, 'a', 1000)).not.toBeNull();
    expect(store.prune(3_600_001, 7).outputs).toBe(1);
    expect(existsSync(join(dataDir, 'tex', 'out', `${id}.pdf`))).toBe(false);
  });
});
