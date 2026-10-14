// LaTeX 프로젝트 가져오기·내보내기. ZIP 읽기·쓰기는 fflate(MIT)로 한다.
// 올릴 때 거르는 것(docs/LATEX.md "데이터 모델"):
//   - ".."·절대 경로·심볼릭 링크·암호화 항목 → 그 항목을 뺀다(안내)
//   - 파일 수·전체 크기 상한, 압축률 100배 초과(zip 폭탄) → 가져오기를 멈춘다
//   - latexmkrc·.latexmkrc(펄 코드라 셸 실행을 다시 켤 수 있다) → 빼고 안내
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { isLatexmkrc, isTexSource, MAX_TEX_FILES, normalizeProjectPath, TEX_ENGINES, type TexEngine } from '@alldoc/shared';
import type { NewTexFile, TexProjectMeta } from './docs';

/** 가져올 때 풀어 놓을 수 있는 전체 크기(브라우저 메모리를 지키려는 상한). 컴파일할 수 있는 크기는 요금제가 따로 정한다. */
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;
/** 이보다 큰 항목에만 압축률을 본다(작은 파일은 많이 줄어도 해가 없다) */
const RATIO_MIN_BYTES = 1024 * 1024;
export const MAX_RATIO = 100;

export class TexImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TexImportError';
  }
}

export interface SkippedEntry {
  path: string;
  reason: 'unsafe-path' | 'symlink' | 'encrypted' | 'latexmkrc' | 'duplicate';
}

export interface ImportedProject {
  files: Array<{ path: string; bytes: Uint8Array }>;
  skipped: SkippedEntry[];
  project: TexProjectMeta;
}

interface CentralEntry {
  /** fflate 가 돌려주는 이름(UTF-8 표시가 없으면 latin1 로 읽은 것) */
  raw: string;
  /** 사람이 읽을 이름(표시가 없어도 UTF-8 로 읽히면 UTF-8) */
  name: string;
  compressed: number;
  size: number;
  symlink: boolean;
  encrypted: boolean;
  dir: boolean;
}

const latin1 = (b: Uint8Array) => {
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
};

/** ZIP 중앙 목록을 직접 읽는다(fflate 는 항목의 파일 종류·암호화 표시를 알려 주지 않는다). */
export function readCentralDirectory(bytes: Uint8Array): CentralEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new TexImportError('ZIP 파일이 아니거나 손상되었어요.');
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff) throw new TexImportError('너무 큰 ZIP(ZIP64)은 아직 열 수 없어요.');
  const out: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50) throw new TexImportError('ZIP 목록이 손상되었어요.');
    const madeBy = v.getUint16(at + 4, true);
    const flags = v.getUint16(at + 8, true);
    const compressed = v.getUint32(at + 20, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const extraLen = v.getUint16(at + 30, true);
    const commentLen = v.getUint16(at + 32, true);
    const external = v.getUint32(at + 38, true);
    if (compressed === 0xffffffff || size === 0xffffffff) throw new TexImportError('너무 큰 ZIP(ZIP64)은 아직 열 수 없어요.');
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLen);
    const utf8Flag = (flags & 0x800) !== 0;
    let name: string;
    try {
      name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes);
    } catch {
      name = latin1(nameBytes);
    }
    const raw = utf8Flag ? new TextDecoder().decode(nameBytes) : latin1(nameBytes);
    const unixMode = madeBy >> 8 === 3 ? external >>> 16 : 0;
    out.push({
      raw,
      name,
      compressed,
      size,
      symlink: (unixMode & 0o170000) === 0o120000,
      encrypted: (flags & 1) !== 0,
      dir: raw.endsWith('/') || (unixMode & 0o170000) === 0o040000,
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** 주석이 아닌 \documentclass 가 있는지 */
const hasDocumentclass = (text: string) => /^[^%\n]*\\documentclass/m.test(text);

/** 주 파일을 고른다: \documentclass 가 있는 .tex 중 main.tex → 얕은 경로 → 이름 순. 없으면 첫 .tex */
export function pickMain(files: Array<{ path: string; text?: string }>): string | null {
  const tex = files.filter((f) => isTexSource(f.path));
  const roots = tex.filter((f) => f.text !== undefined && hasDocumentclass(f.text));
  const pool = roots.length > 0 ? roots : tex;
  const sorted = [...pool].sort((a, b) => {
    const am = /(^|\/)main\.tex$/i.test(a.path) ? 0 : 1;
    const bm = /(^|\/)main\.tex$/i.test(b.path) ? 0 : 1;
    if (am !== bm) return am - bm;
    const ad = a.path.split('/').length;
    const bd = b.path.split('/').length;
    if (ad !== bd) return ad - bd;
    return a.path < b.path ? -1 : 1;
  });
  return sorted[0]?.path ?? null;
}

/** 엔진을 고른다: "% !TEX program = …" 표시 → luatexko 면 LuaLaTeX → 그 밖에는 XeLaTeX(한국어 기본) */
export function pickEngine(mainText: string): TexEngine {
  const magic = /^%\s*!T[EX]+\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(mainText)?.[1]?.toLowerCase();
  if (magic && (TEX_ENGINES as readonly string[]).includes(magic)) return magic as TexEngine;
  if (/^[^%\n]*\\usepackage(\[[^\]]*\])?\{[^}]*\bluatexko\b/m.test(mainText)) return 'lualatex';
  return 'xelatex';
}

const dec = new TextDecoder();

/** 풀어 놓은 파일들로 프로젝트 설정(주 파일·엔진)을 정한다. .tex 가 없으면 TexImportError */
export function projectOf(files: Array<{ path: string; bytes: Uint8Array }>): TexProjectMeta {
  const withText = files.map((f) => ({ path: f.path, text: isTexSource(f.path) ? dec.decode(f.bytes) : undefined }));
  const main = pickMain(withText);
  if (!main) throw new TexImportError('ZIP 안에 .tex 파일이 없어요. LaTeX 프로젝트 ZIP 을 올려 주세요.');
  return { main, engine: pickEngine(withText.find((f) => f.path === main)?.text ?? '') };
}

/** ZIP 을 검사하고 푼다. */
export function importZip(bytes: Uint8Array, limits: { maxBytes?: number; maxFiles?: number } = {}): ImportedProject {
  const maxBytes = limits.maxBytes ?? MAX_IMPORT_BYTES;
  const maxFiles = limits.maxFiles ?? MAX_TEX_FILES;
  const entries = readCentralDirectory(bytes);
  const skipped: SkippedEntry[] = [];
  const take = new Map<string, string>(); // fflate 이름 → 프로젝트 경로
  let total = 0;
  for (const e of entries) {
    if (e.dir) continue;
    // macOS 가 덧붙이는 자원 파일은 조용히 뺀다.
    if (/(^|\/)__MACOSX\//.test(e.name) || /(^|\/)\.DS_Store$/.test(e.name)) continue;
    const path = normalizeProjectPath(e.name);
    if (!path) {
      skipped.push({ path: e.name, reason: 'unsafe-path' });
      continue;
    }
    if (e.symlink) {
      skipped.push({ path, reason: 'symlink' });
      continue;
    }
    if (e.encrypted) {
      skipped.push({ path, reason: 'encrypted' });
      continue;
    }
    if (isLatexmkrc(path)) {
      skipped.push({ path, reason: 'latexmkrc' });
      continue;
    }
    if ([...take.values()].includes(path)) {
      skipped.push({ path, reason: 'duplicate' });
      continue;
    }
    if (e.size > RATIO_MIN_BYTES && e.size > e.compressed * MAX_RATIO) {
      throw new TexImportError(`압축률이 비정상적으로 높은 파일이 있어 열지 않았어요(${path}). 압축 폭탄일 수 있어요.`);
    }
    total += e.size;
    if (total > maxBytes) throw new TexImportError(`풀면 너무 커요. 프로젝트는 풀었을 때 ${Math.floor(maxBytes / 1024 / 1024)}MB 까지 열 수 있어요.`);
    take.set(e.raw, path);
    if (take.size > maxFiles) throw new TexImportError(`파일이 너무 많아요. 한 프로젝트에 ${maxFiles}개까지 넣을 수 있어요.`);
  }
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, { filter: (f) => take.has(f.name) });
  } catch {
    throw new TexImportError('ZIP 을 풀지 못했어요. 파일이 손상되었거나 지원하지 않는 압축 방식이에요.');
  }
  let files = Object.entries(raw)
    .filter(([name]) => take.has(name))
    .map(([name, b]) => ({ path: take.get(name) as string, bytes: b }));
  if (files.reduce((n, f) => n + f.bytes.byteLength, 0) > maxBytes) throw new TexImportError('풀면 너무 커요.');
  files = stripCommonFolder(files);
  return { files, skipped, project: projectOf(files) };
}

/** 모든 파일이 폴더 하나 안에 있으면(예: "논문/main.tex") 그 폴더를 벗긴다. */
export function stripCommonFolder<T extends { path: string }>(files: T[]): T[] {
  if (files.length === 0) return files;
  const first = files[0]?.path.split('/')[0];
  if (!first || !files.every((f) => f.path.startsWith(`${first}/`))) return files;
  return files.map((f) => ({ ...f, path: f.path.slice(first.length + 1) }));
}

/** .tex 하나로 파일 하나짜리 프로젝트를 만든다. */
export function importSingleTex(name: string, bytes: Uint8Array): ImportedProject {
  const path = normalizeProjectPath(name.split(/[\\/]/).pop() ?? 'main.tex') ?? 'main.tex';
  const files = [{ path, bytes }];
  return { files, skipped: [], project: { main: path, engine: pickEngine(dec.decode(bytes)) } };
}

export async function sha256Hex(data: Blob | Uint8Array): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest('SHA-256', buf as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const mimeOf = (path: string) => (isTexSource(path) || /\.(bib|sty|cls|txt|md)$/i.test(path) ? 'text/plain;charset=utf-8' : 'application/octet-stream');

export async function toRecords(files: Array<{ path: string; bytes: Uint8Array }>): Promise<NewTexFile[]> {
  return Promise.all(files.map(async (f) => ({ path: f.path, blob: new Blob([f.bytes as BlobPart], { type: mimeOf(f.path) }), hash: await sha256Hex(f.bytes) })));
}

/** 프로젝트를 ZIP 하나로(내려받기). 글 파일만 압축하고 그림(이미 압축된 것)은 그대로 넣는다. */
export async function exportZip(files: Array<{ path: string; blob: Blob }>): Promise<Blob> {
  const z: Zippable = {};
  for (const f of files) {
    const b = new Uint8Array(await f.blob.arrayBuffer());
    z[f.path] = [b, { level: /\.(png|jpe?g|gif|pdf|zip|gz)$/i.test(f.path) ? 0 : 6 }];
  }
  return new Blob([zipSync(z) as BlobPart], { type: 'application/zip' });
}

export const SKIP_REASON_TEXT: Record<SkippedEntry['reason'], string> = {
  'unsafe-path': '프로젝트 밖을 가리키는 경로',
  symlink: '심볼릭 링크',
  encrypted: '암호가 걸린 항목',
  latexmkrc: 'latexmk 설정 파일(보안상 쓰지 않음)',
  duplicate: '같은 이름이 두 번',
};

/** 빠진 항목 안내 문장(없으면 null) */
export function skippedNotice(skipped: SkippedEntry[]): string | null {
  if (skipped.length === 0) return null;
  const head = skipped
    .slice(0, 3)
    .map((s) => `${s.path}(${SKIP_REASON_TEXT[s.reason]})`)
    .join(', ');
  return `${skipped.length}개 항목을 빼고 열었어요: ${head}${skipped.length > 3 ? ' 등' : ''}`;
}
