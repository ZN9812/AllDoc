// LaTeX 컴파일 일꾼. 본 서버만 내부망으로 부른다(포트를 밖으로 열지 않는다). 비밀값·DB·파일 저장소를 갖지 않고,
// 작업마다 받은 파일만 작업 폴더에 썼다가 끝나면 지운다.
//   GET  /health   {ok, texlive}
//   POST /compile  서명한 작업 묶음 → 묶음 응답(머리: status·log·wallMs·texlive·hasPdf, 덩어리: PDF)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { decodeFrame, encodeFrame, FrameError } from '@alldoc/shared';
import { JobRejected, runJob, validateJob, type RunOptions } from './run';
import { SIGNATURE_HEADER, verifyBody } from './sign';

const MB = 1024 * 1024;
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} 값이 올바르지 않아요.`);
  return v;
};

const secret = process.env.COMPILER_SECRET ?? '';
if (secret.length < 32) {
  console.error('COMPILER_SECRET 은 32자 이상이어야 해요(본 서버와 같은 값).');
  process.exit(1);
}
// 컴파일되는 TeX 쪽에서 비밀값을 볼 수 없게 이 프로세스의 환경에서도 지운다(bwrap 은 --clearenv 로 따로 비운다).
delete process.env.COMPILER_SECRET;

const sandbox = process.env.SANDBOX === 'none' ? 'none' : 'bwrap';
if (sandbox === 'none') console.warn('경고: SANDBOX=none 은 격리 없이 TeX 를 돌려요. 개발용으로만 쓰세요.');

const opt: RunOptions = {
  workRoot: process.env.WORK_DIR ?? '/work',
  sandbox,
  roBinds: (process.env.SANDBOX_RO_BINDS ?? '/usr,/etc/texmf,/var/lib/texmf,/etc/fonts,/var/cache/fontconfig,/etc/ld.so.cache,/etc/alternatives')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  memBytes: num('JOB_MEM_MB', 2048) * MB,
  fileBytes: num('JOB_FILE_MB', 200) * MB,
  nproc: num('JOB_NPROC', 256),
  logBytes: 2 * MB,
  pdfBytes: num('JOB_PDF_MB', 200) * MB,
};
const maxBody = num('MAX_BODY_MB', 300) * MB;
const maxTimeoutSec = num('MAX_TIMEOUT_SEC', 600);
const concurrency = num('WORKER_CONCURRENCY', 1);
const port = num('PORT', 8790);

let texlive = 'unknown';
try {
  const v = execFileSync('tex', ['--version'], { encoding: 'utf8', timeout: 10_000 });
  texlive = /\((TeX Live [^)]+)\)/.exec(v)?.[1] ?? v.split('\n')[0] ?? 'unknown';
} catch {
  console.warn('tex --version 을 읽지 못했어요. TeX Live 가 설치되어 있는지 확인하세요.');
}

// 지난번에 끝나지 못한 작업 폴더를 지운다.
mkdirSync(opt.workRoot, { recursive: true });
for (const d of readdirSync(opt.workRoot)) rmSync(join(opt.workRoot, d), { recursive: true, force: true });

let active = 0;

function readBody(req: IncomingMessage, max: number): Promise<Uint8Array | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > max) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string | Uint8Array, type = 'application/json'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, JSON.stringify({ ok: true, texlive, sandbox, active }));
    if (req.method !== 'POST' || req.url !== '/compile') return send(res, 404, JSON.stringify({ error: 'not_found' }));
    const body = await readBody(req, maxBody);
    if (!body) return send(res, 413, JSON.stringify({ error: 'too_large' }));
    const sig = req.headers[SIGNATURE_HEADER];
    if (!verifyBody(secret, body, Array.isArray(sig) ? sig[0] : sig, Date.now())) return send(res, 401, JSON.stringify({ error: 'bad_signature' }));
    if (active >= concurrency) return send(res, 503, JSON.stringify({ error: 'busy' }));
    let job;
    try {
      const f = decodeFrame<Record<string, unknown>>(body);
      job = validateJob(f.header, f.parts, maxTimeoutSec);
    } catch (e) {
      if (e instanceof JobRejected || e instanceof FrameError) return send(res, 400, JSON.stringify({ error: 'bad_job', message: e.message }));
      throw e;
    }
    active++;
    try {
      const r = await runJob(job, opt);
      console.log(JSON.stringify({ msg: '컴파일', engine: job.engine, files: job.files.length, status: r.status, wallMs: r.wallMs }));
      send(res, 200, encodeFrame({ status: r.status, log: r.log, wallMs: r.wallMs, texlive, hasPdf: r.pdf !== null }, r.pdf ? [r.pdf] : []), 'application/octet-stream');
    } finally {
      active--;
    }
  } catch (e) {
    console.error('일꾼 오류', e instanceof Error ? e.message : e);
    if (!res.headersSent) send(res, 500, JSON.stringify({ error: 'internal' }));
  }
});
server.requestTimeout = (maxTimeoutSec + 60) * 1000;
server.listen(port, () => console.log(`컴파일 일꾼: 포트 ${port}, ${texlive}, 격리 ${sandbox}, 동시 ${concurrency}`));
for (const s of ['SIGTERM', 'SIGINT'] as const) process.on(s, () => server.close(() => process.exit(0)));
