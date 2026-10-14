// 본 서버 ↔ 컴파일 일꾼 사이의 작업 묶음 형식. 머리(JSON) 하나와 이진 덩어리 여러 개를 한 본문에 담는다.
//   [머리 길이: 4바이트 빅엔디언][머리 JSON(UTF-8)][덩어리 1][덩어리 2]…
// 머리의 parts 에 덩어리 길이를 차례로 적는다. tar 대신 쓰는 것은 경로 길이 제한·확장 머리를 다룰 필요가 없어서다.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** 머리 JSON 의 최대 크기(파일 목록 1000개를 넉넉히 담는다) */
export const MAX_FRAME_HEADER_BYTES = 1024 * 1024;

export class FrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameError';
  }
}

export function encodeFrame(header: Record<string, unknown>, parts: Uint8Array[]): Uint8Array {
  const head = enc.encode(JSON.stringify({ ...header, parts: parts.map((p) => p.byteLength) }));
  const total = 4 + head.byteLength + parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, head.byteLength);
  out.set(head, 4);
  let at = 4 + head.byteLength;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** 묶음을 푼다. 길이가 맞지 않으면 FrameError. 덩어리는 원본을 복사하지 않고 잘라서 돌려준다. */
export function decodeFrame<H extends Record<string, unknown>>(bytes: Uint8Array): { header: H & { parts: number[] }; parts: Uint8Array[] } {
  if (bytes.byteLength < 4) throw new FrameError('묶음이 너무 짧아요.');
  const headLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (headLen > MAX_FRAME_HEADER_BYTES || 4 + headLen > bytes.byteLength) throw new FrameError('묶음 머리 길이가 올바르지 않아요.');
  let header: H & { parts: number[] };
  try {
    header = JSON.parse(dec.decode(bytes.subarray(4, 4 + headLen))) as H & { parts: number[] };
  } catch {
    throw new FrameError('묶음 머리를 읽지 못했어요.');
  }
  if (!header || typeof header !== 'object' || !Array.isArray(header.parts) || !header.parts.every((n) => Number.isSafeInteger(n) && n >= 0)) {
    throw new FrameError('묶음 머리에 덩어리 길이가 없어요.');
  }
  let at = 4 + headLen;
  const parts: Uint8Array[] = [];
  for (const n of header.parts) {
    if (at + n > bytes.byteLength) throw new FrameError('묶음이 잘렸어요.');
    parts.push(bytes.subarray(at, at + n));
    at += n;
  }
  if (at !== bytes.byteLength) throw new FrameError('묶음 뒤에 남는 바이트가 있어요.');
  return { header, parts };
}
