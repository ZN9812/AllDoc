// 작업 하나를 컴파일한다: 작업 폴더에 파일을 쓰고 → bubblewrap 안에서 latexmk 를 돌리고 → 로그·PDF 를 읽고 → 폴더를 지운다.
// 격리(docs/LATEX.md "격리"):
//   바깥층  컨테이너(docker-compose.yml 의 compiler 서비스: 내부망, 읽기 전용 루트, cap_drop ALL, seccomp 프로필)
//   안쪽층  작업마다 bwrap: 네트워크·PID·IPC 등 이름공간 분리, 환경변수 비움, TeX 와 글꼴만 읽기 전용, 작업 폴더만 쓰기
//          + prlimit(주소 공간·CPU 시간·파일 크기·프로세스 수) + 벽시계 시간 제한(넘으면 프로세스 묶음을 강제 종료)
//   TeX    shell_escape=f, openin_any=p, openout_any=p, latexmk -norc(프로젝트의 latexmkrc 를 읽지 않음)
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, readlinkSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { isLatexmkrc, isTexSource, MAX_TEX_FILES, normalizeProjectPath, TEX_ENGINES, type CompileStatus, type TexEngine } from '@alldoc/shared';

export interface JobInput {
  jobId: string;
  engine: TexEngine;
  main: string;
  timeoutSec: number;
  files: Array<{ path: string; bytes: Uint8Array }>;
}

export interface RunOptions {
  /** 작업 폴더를 만들 곳(컨테이너의 /work, 용량 상한이 있는 tmpfs) */
  workRoot: string;
  /** bwrap: 작업마다 bubblewrap 으로 감싼다(운영) · none: 감싸지 않는다(개발용, 운영 금지) */
  sandbox: 'bwrap' | 'none';
  /** bwrap 안에 읽기 전용으로 붙일 경로(TeX Live·글꼴). 없는 경로는 건너뛴다 */
  roBinds: string[];
  /** 작업 하나의 주소 공간 상한(바이트) */
  memBytes: number;
  /** 작업이 만들 수 있는 파일 하나의 크기 상한(바이트, 로그 폭주·PDF 폭증 대비) */
  fileBytes: number;
  /** 같은 사용자의 프로세스(스레드) 수 상한 */
  nproc: number;
  /** 돌려줄 로그 끝부분 상한(바이트) */
  logBytes: number;
  /** 돌려줄 PDF 상한(바이트) */
  pdfBytes: number;
  /** 시험용: 작업 폴더를 지우기 전에 들여다본다 */
  inspect?: (dir: string) => void | Promise<void>;
}

export interface JobResult {
  status: CompileStatus;
  log: string;
  pdf: Uint8Array | null;
  wallMs: number;
}

export class JobRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobRejected';
  }
}

const ENGINE_FLAG: Record<TexEngine, string> = { xelatex: '-xelatex', pdflatex: '-pdf', lualatex: '-lualatex' };

/** 본 서버가 보낸 작업 머리를 검사한다. 이상하면 JobRejected. */
export function validateJob(header: Record<string, unknown>, parts: Uint8Array[], maxTimeoutSec: number): JobInput {
  const { jobId, engine, main, timeoutSec, files } = header as { jobId: unknown; engine: unknown; main: unknown; timeoutSec: unknown; files: unknown };
  if (typeof jobId !== 'string' || !/^[0-9a-f-]{36}$/.test(jobId)) throw new JobRejected('작업 번호가 올바르지 않아요.');
  if (typeof engine !== 'string' || !(TEX_ENGINES as readonly string[]).includes(engine)) throw new JobRejected('엔진이 올바르지 않아요.');
  if (typeof timeoutSec !== 'number' || !Number.isInteger(timeoutSec) || timeoutSec < 1 || timeoutSec > maxTimeoutSec) throw new JobRejected('시간 제한이 올바르지 않아요.');
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_TEX_FILES || files.length !== parts.length) throw new JobRejected('파일 목록이 올바르지 않아요.');
  const seen = new Set<string>();
  const out: JobInput['files'] = [];
  files.forEach((p, i) => {
    if (typeof p !== 'string' || normalizeProjectPath(p) !== p) throw new JobRejected(`쓸 수 없는 경로예요: ${String(p).slice(0, 80)}`);
    if (isLatexmkrc(p)) throw new JobRejected('latexmkrc 는 받지 않아요.');
    // 대소문자만 다른 이름도 같은 것으로 본다(대소문자를 가리지 않는 파일 시스템에서 덮어쓰지 않도록).
    const key = p.toLowerCase();
    if (seen.has(key)) throw new JobRejected('같은 경로가 두 번 있어요.');
    seen.add(key);
    out.push({ path: p, bytes: parts[i] as Uint8Array });
  });
  if (typeof main !== 'string' || !seen.has(main.toLowerCase()) || !isTexSource(main) || normalizeProjectPath(main) !== main) throw new JobRejected('주 파일이 올바르지 않아요.');
  return { jobId, engine: engine as TexEngine, main, timeoutSec, files: out };
}

/** 끝부분만 남긴다 */
function tailBytes(b: Buffer, max: number): string {
  if (b.length <= max) return b.toString('utf8');
  return `…(앞부분 생략)\n${b.subarray(b.length - max).toString('utf8')}`;
}

async function readIf(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

/** bwrap 에 넘길 인자. /lib·/bin 같은 경로가 심볼릭 링크면(합쳐진 /usr) 그대로 링크로 만든다. */
export function bwrapArgs(jobDir: string, opt: Pick<RunOptions, 'roBinds'>, env: Record<string, string>): string[] {
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv'];
  for (const p of opt.roBinds) if (existsSync(p)) args.push('--ro-bind', p, p);
  for (const p of ['/lib', '/lib64', '/bin', '/sbin']) {
    if (opt.roBinds.includes(p)) continue;
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) args.push('--symlink', readlinkSync(p), p);
      else if (st.isDirectory()) args.push('--ro-bind', p, p);
    } catch {
      // 없는 경로
    }
  }
  args.push('--bind', jobDir, '/w', '--tmpfs', '/tmp', '--dev', '/dev', '--chdir', '/w');
  for (const [k, v] of Object.entries(env)) args.push('--setenv', k, v);
  return args;
}

export async function runJob(job: JobInput, opt: RunOptions): Promise<JobResult> {
  const jobDir = join(opt.workRoot, job.jobId);
  const started = Date.now();
  await mkdir(jobDir, { recursive: false, mode: 0o700 });
  try {
    for (const f of job.files) {
      const dest = join(jobDir, ...f.path.split('/'));
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.bytes, { flag: 'wx' });
    }
    const texEnv: Record<string, string> = {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      TEXMFVAR: '/tmp/texmf-var',
      max_print_line: '10000',
      shell_escape: 'f',
      openin_any: 'p',
      openout_any: 'p',
    };
    const cpuSec = job.timeoutSec + 5;
    const limited = ['prlimit', `--as=${opt.memBytes}`, `--cpu=${cpuSec}`, `--fsize=${opt.fileBytes}`, `--nproc=${opt.nproc}`, '--'];
    const latexmk = ['latexmk', '-norc', ENGINE_FLAG[job.engine], '-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-cd', job.main];
    const [cmd, args, cwd, env] =
      opt.sandbox === 'bwrap'
        ? ['bwrap', [...bwrapArgs(jobDir, opt, texEnv), ...limited, ...latexmk], undefined, {}]
        : [limited[0] as string, [...limited.slice(1), ...latexmk], jobDir, texEnv];

    const out: Buffer[] = [];
    let outBytes = 0;
    let timedOut = false;
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const keep = (b: Buffer) => {
        if (outBytes < opt.logBytes) out.push(b);
        outBytes += b.length;
      };
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          // 이미 끝났다
        }
      }, job.timeoutSec * 1000);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(-1);
      });
      child.on('close', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
    });
    const wallMs = Date.now() - started;

    // 로그: 주 파일의 .log 끝부분 + 참고문헌(.blg). 없으면 latexmk 출력.
    const base = posix.join(posix.dirname(job.main), posix.basename(job.main).replace(/\.(tex|ltx)$/i, ''));
    const at = (ext: string) => join(jobDir, ...`${base}.${ext}`.split('/'));
    const mainLog = await readIf(at('log'));
    const blg = await readIf(at('blg'));
    let log = mainLog ? tailBytes(mainLog, opt.logBytes) : tailBytes(Buffer.concat(out), opt.logBytes);
    if (blg) log += `\n\n=== ${posix.basename(base)}.blg ===\n${tailBytes(blg, 256 * 1024)}`;
    if (!mainLog && outBytes > 0) log = `latexmk 출력:\n${log}`;
    if (timedOut) return { status: 'timeout', log: `시간 제한(${job.timeoutSec}초)을 넘어 컴파일을 멈췄어요.\n${log}`, pdf: null, wallMs };

    let pdf: Uint8Array | null = null;
    let status: CompileStatus = 'error';
    try {
      const st = await stat(at('pdf'));
      if (st.size > opt.pdfBytes) status = 'too_large';
      else if (code === 0) {
        pdf = new Uint8Array(await readFile(at('pdf')));
        status = 'ok';
      }
    } catch {
      // PDF 가 없다
    }
    if (code === -1) log = `컴파일 도구를 실행하지 못했어요(${cmd}).\n${log}`;
    return { status, log, pdf, wallMs };
  } finally {
    try {
      await opt.inspect?.(jobDir);
    } finally {
      await rm(jobDir, { recursive: true, force: true });
    }
  }
}
