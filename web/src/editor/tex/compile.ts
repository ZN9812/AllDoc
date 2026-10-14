// LaTeX 컴파일 요청: ① 서버에 없는 파일만 골라(해시 대조) ② 올리고 ③ 컴파일하고 ④ PDF를 받는다.
import { BlobCheckResponseSchema, CompileResponseSchema, ErrorResponseSchema, type CompileResponse, type TexEngine } from '@alldoc/shared';
import { z } from 'zod';
import { ApiError } from '../../ai/client';

export interface CompileFileInput {
  path: string;
  blob: Blob;
  hash: string;
}

export interface CompileOutcome {
  response: CompileResponse;
  /** 성공했을 때의 PDF 바이트 */
  pdf: Uint8Array | null;
}

const MissingSchema = z.object({ missing: z.array(z.string()) });

async function call(path: string, init: RequestInit): Promise<{ res: Response; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    throw new ApiError(0, 'network', '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.');
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 아래에서 일반 오류로 처리한다.
  }
  return { res, body };
}

function errorOf(res: Response, body: unknown): ApiError {
  const parsed = ErrorResponseSchema.safeParse(body);
  if (parsed.success) return new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
  return new ApiError(res.status, 'http_error', res.status >= 500 ? '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.' : '요청을 처리하지 못했어요.');
}

const json = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });

/** 서버에 없는 해시를 올린다(동시에 3개씩). */
async function uploadMissing(files: CompileFileInput[], missing: string[], signal?: AbortSignal, onUpload?: (done: number, total: number) => void): Promise<void> {
  const need = new Map<string, CompileFileInput>();
  for (const f of files) if (missing.includes(f.hash) && !need.has(f.hash)) need.set(f.hash, f);
  const queue = [...need.values()];
  let done = 0;
  onUpload?.(0, queue.length);
  const worker = async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      const { res, body } = await call(`/api/tex/blobs/${f.hash}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: f.blob, signal });
      if (!res.ok) throw errorOf(res, body);
      onUpload?.(++done, need.size);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export async function compileProject(
  input: { files: CompileFileInput[]; main: string; engine: TexEngine },
  options: { signal?: AbortSignal; onUpload?: (done: number, total: number) => void; onCompiling?: () => void } = {},
): Promise<CompileOutcome> {
  const { signal, onUpload, onCompiling } = options;
  const check = await call('/api/tex/blobs/check', json({ hashes: input.files.map((f) => f.hash) }, signal));
  if (!check.res.ok) throw errorOf(check.res, check.body);
  const missing = BlobCheckResponseSchema.parse(check.body).missing;
  await uploadMissing(input.files, missing, signal, onUpload);

  onCompiling?.();
  const req = { engine: input.engine, main: input.main, files: input.files.map((f) => ({ path: f.path, hash: f.hash, size: f.blob.size })) };
  let out = await call('/api/tex/compile', json(req, signal));
  // 그 사이 서버가 파일을 지웠으면(보관 기간) 한 번 더 올리고 다시 시도한다.
  if (out.res.status === 409) {
    const again = MissingSchema.safeParse(out.body);
    if (again.success) {
      await uploadMissing(input.files, again.data.missing, signal, onUpload);
      out = await call('/api/tex/compile', json(req, signal));
    }
  }
  if (!out.res.ok) throw errorOf(out.res, out.body);
  const parsed = CompileResponseSchema.safeParse(out.body);
  if (!parsed.success) throw new ApiError(out.res.status, 'bad_response', '서버 응답을 이해하지 못했어요.');
  const response = parsed.data;
  let pdf: Uint8Array | null = null;
  if (response.pdfUrl) {
    let r: Response;
    try {
      r = await fetch(response.pdfUrl, { credentials: 'same-origin', signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new ApiError(0, 'network', 'PDF를 받지 못했어요. 인터넷 연결을 확인해 주세요.');
    }
    if (!r.ok) throw new ApiError(r.status, 'pdf_missing', 'PDF를 받지 못했어요. 다시 컴파일해 주세요.');
    pdf = new Uint8Array(await r.arrayBuffer());
  }
  return { response, pdf };
}
