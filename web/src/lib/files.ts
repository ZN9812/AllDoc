import { baseName, extOf, kindFromName, MAX_FILE_BYTES, type DocKind } from '@alldoc/shared';

export type FileCheck =
  | { ok: true; kind: DocKind }
  | { ok: false; message: string };

/** 올린 파일을 열 수 있는지 확인한다. 안 되면 사용자에게 보여줄 문장을 돌려준다. */
export function checkUpload(file: { name: string; size: number }): FileCheck {
  const kind = kindFromName(file.name);
  if (!kind) {
    const ext = extOf(file.name);
    const what = ext ? `.${ext} 형식은` : '이 파일은';
    return { ok: false, message: `${what} 아직 열 수 없어요. HWP, HWPX, DOCX, PDF, TXT, MD 파일을 올려 주세요.` };
  }
  if (file.size === 0) return { ok: false, message: '빈 파일이에요.' };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `파일이 너무 커요. ${Math.floor(MAX_FILE_BYTES / 1024 / 1024)}MB 이하만 열 수 있어요.` };
  }
  return { ok: true, kind };
}

/**
 * 내려받을 파일 이름. 원본을 덮어쓰지 않도록, 고친 문서는 이름 뒤에 "_수정본"을 붙인다.
 * ext 를 주면 그 확장자로(예: PDF 내보내기) 바꾼다.
 */
export function exportName(originalName: string, edited: boolean, ext?: string): string {
  const base = baseName(originalName);
  const e = ext ?? extOf(originalName);
  const stem = edited ? `${base}_수정본` : base;
  return e ? `${stem}.${e}` : stem;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 다운로드가 시작될 시간을 준 뒤 해제한다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** 사람이 읽기 쉬운 파일 크기 (예: 340KB, 12.3MB) */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  const mb = n / 1024 / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)}MB`;
}
