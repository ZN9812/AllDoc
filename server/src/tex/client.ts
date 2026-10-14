// 컴파일 일꾼 연결부. 본 서버는 인증·한도·파일 확인을 맡고, 실제 컴파일은 이 인터페이스 뒤의 일꾼이 한다(docs/LATEX.md "컴파일 서버").
//   MockCompilerClient : COMPILER=mock. TeX 없이 정해진 규칙으로 로그와 작은 PDF를 만든다(시험·데모용).
//   HttpCompilerClient : COMPILER=http. 내부망의 일꾼(compiler/)에게 서명한 작업 묶음을 보낸다.
import { decodeFrame, encodeFrame, FrameError, isTexSource, type CompileStatus, type TexEngine } from '@alldoc/shared';
import { makeMockPdf } from './mockPdf';
import { SIGNATURE_HEADER, signBody } from './sign';

export interface CompileJob {
  jobId: string;
  engine: TexEngine;
  main: string;
  files: Array<{ path: string; bytes: Uint8Array }>;
  timeoutSec: number;
}

export interface CompileResult {
  status: CompileStatus;
  /** 주 .log 끝부분(+ .blg). 일꾼이 상한(2MB)으로 자른다 */
  log: string;
  pdf: Uint8Array | null;
  /** 일꾼이 잰 컴파일 시간(밀리초) */
  wallMs: number;
  /** TeX Live 판(결과 캐시 키와 원장에 쓴다) */
  texlive: string;
}

export interface CompilerClient {
  readonly id: 'mock' | 'http';
  readonly demo: boolean;
  compile(job: CompileJob, signal: AbortSignal): Promise<CompileResult>;
}

export class CompilerFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CompilerFailedError';
  }
}

const dec = new TextDecoder();

/**
 * 데모 컴파일러. 규칙(종단 시험과 데모 화면에 쓴다):
 * - 주 파일이 없으면 "File not found" 오류
 * - `\begin{itemise}` 가 있는 줄은 "Environment itemise undefined" 오류(파일:줄)
 * - `\ref{x}` 에 맞는 `\label{x}` 가 없으면 경고
 * - `% mock:sleep=<초>` 가 있으면 그만큼 걸린 것으로 치고, 시간 제한을 넘으면 timeout
 * - 오류가 없으면 `\newpage` 수 + 1 쪽짜리 PDF(쪽마다 "AllDoc demo PDF · <파일> · page N")
 */
export class MockCompilerClient implements CompilerClient {
  readonly id = 'mock' as const;
  readonly demo = true;

  constructor(private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void> = defaultSleep) {}

  async compile(job: CompileJob, signal: AbortSignal): Promise<CompileResult> {
    const started = Date.now();
    const texts = new Map(job.files.filter((f) => isTexSource(f.path)).map((f) => [f.path, dec.decode(f.bytes)]));
    const all = [...texts.values()].join('\n');
    const sleepSec = Number(/% mock:sleep=(\d+(?:\.\d+)?)/.exec(all)?.[1] ?? 0);
    const log: string[] = [`This is XeTeX (AllDoc 데모 컴파일러, 실제 TeX 아님) — engine ${job.engine}`, `(./${job.main}`];
    if (sleepSec > 0) {
      const wait = Math.min(sleepSec, job.timeoutSec) * 1000;
      await this.sleep(wait, signal);
      if (sleepSec > job.timeoutSec) {
        log.push('', `! 데모 컴파일러: 시간 제한(${job.timeoutSec}초)을 넘었어요.`);
        return { status: 'timeout', log: log.join('\n'), pdf: null, wallMs: Date.now() - started, texlive: 'mock' };
      }
    }
    const main = texts.get(job.main);
    if (main === undefined) {
      log.push('', `! LaTeX Error: File \`${job.main}' not found.`, ')');
      return { status: 'error', log: log.join('\n'), pdf: null, wallMs: Date.now() - started, texlive: 'mock' };
    }
    const labels = new Set([...all.matchAll(/\\label\{([^}]*)\}/g)].map((m) => m[1]));
    let errors = 0;
    for (const [path, text] of texts) {
      if (path !== job.main) log.push(`(./${path}`);
      text.split('\n').forEach((line, i) => {
        if (/\\begin\{itemise\}/.test(line)) {
          errors++;
          log.push('', `./${path}:${i + 1}: LaTeX Error: Environment itemise undefined.`, '', `l.${i + 1} ${line.slice(0, 60)}`, '');
        }
        for (const m of line.matchAll(/\\ref\{([^}]*)\}/g)) {
          if (!labels.has(m[1])) log.push('', `LaTeX Warning: Reference \`${m[1]}' on page 1 undefined on input line ${i + 1}.`, '');
        }
      });
      if (path !== job.main) log.push(')');
    }
    log.push(')');
    if (errors > 0) return { status: 'error', log: log.join('\n'), pdf: null, wallMs: Date.now() - started, texlive: 'mock' };
    const pages = Math.min(20, (main.match(/\\newpage\b/g)?.length ?? 0) + 1);
    const pdf = makeMockPdf(Array.from({ length: pages }, (_, i) => `AllDoc demo PDF - ${job.main} - page ${i + 1}`));
    log.push(`Output written on ${job.main.replace(/\.tex$/, '.pdf')} (${pages} page${pages > 1 ? 's' : ''}).`);
    return { status: 'ok', log: log.join('\n'), pdf, wallMs: Date.now() - started, texlive: 'mock' };
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** 일꾼이 돌려주는 머리 */
interface WorkerReply {
  status: CompileStatus;
  log: string;
  wallMs: number;
  texlive: string;
  hasPdf: boolean;
}

/**
 * 내부망의 컴파일 일꾼(compiler/)에 보낸다. 일꾼이 여러 대면 차례로 돌려 쓴다(COMPILER_URLS).
 * 요청: POST <url>/compile, 본문은 작업 묶음(shared/src/tex/frame.ts), 서명 머리 x-alldoc-signature.
 * 응답: 같은 묶음 형식(머리 = WorkerReply, 덩어리 = PDF 0개 또는 1개).
 */
export class HttpCompilerClient implements CompilerClient {
  readonly id = 'http' as const;
  readonly demo = false;
  private next = 0;

  constructor(
    private readonly urls: string[],
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (urls.length === 0) throw new Error('컴파일 일꾼 주소가 없어요.');
  }

  async compile(job: CompileJob, signal: AbortSignal): Promise<CompileResult> {
    const url = this.urls[this.next++ % this.urls.length] as string;
    const body = encodeFrame(
      { jobId: job.jobId, engine: job.engine, main: job.main, timeoutSec: job.timeoutSec, files: job.files.map((f) => f.path) },
      job.files.map((f) => f.bytes),
    );
    let res: Response;
    try {
      res = await this.fetchImpl(`${url.replace(/\/+$/, '')}/compile`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', [SIGNATURE_HEADER]: signBody(this.secret, body, Date.now()) },
        body,
        signal,
      });
    } catch (e) {
      throw new CompilerFailedError('컴파일 서버에 연결하지 못했어요.', { cause: e });
    }
    if (!res.ok) throw new CompilerFailedError(`컴파일 서버가 오류를 돌려줬어요(${res.status}).`);
    try {
      const { header, parts } = decodeFrame<Record<string, unknown>>(new Uint8Array(await res.arrayBuffer()));
      const h = header as unknown as WorkerReply;
      if (typeof h.status !== 'string' || typeof h.log !== 'string') throw new FrameError('응답 머리 형식이 달라요.');
      return { status: h.status, log: h.log, wallMs: Number(h.wallMs) || 0, texlive: String(h.texlive ?? ''), pdf: h.hasPdf ? (parts[0] ?? null) : null };
    } catch (e) {
      throw new CompilerFailedError('컴파일 서버의 응답을 읽지 못했어요.', { cause: e });
    }
  }
}
