// DOCX 는 ZIP 파일이다. 서식을 읽으려고 필요한 파일 몇 개만 꺼내는 아주 작은 ZIP 읽기(저장·deflate 방식만).

const dec = new TextDecoder('utf-8');

function u16(b: Uint8Array, o: number): number {
  return (b[o] as number) | ((b[o + 1] as number) << 8);
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] as number) | ((b[o + 1] as number) << 8) | ((b[o + 2] as number) << 16) | ((b[o + 3] as number) << 24)) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** names 에 있는 파일만 꺼내 돌려준다. 없는 파일은 결과에 없다. */
export async function readZipFiles(bytes: Uint8Array, names: readonly string[]): Promise<Map<string, Uint8Array>> {
  // 끝에서부터 "중앙 디렉터리 끝" 표시(0x06054b50)를 찾는다(뒤에 설명이 붙을 수 있다).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('DOCX 파일 형식이 올바르지 않아요.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);

  const want = new Set(names);
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count && want.size > out.size; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('DOCX 파일 형식이 올바르지 않아요.');
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want.has(name)) continue;

    if (u32(bytes, local) !== 0x04034b50) throw new Error('DOCX 파일 형식이 올바르지 않아요.');
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) out.set(name, raw);
    else if (method === 8) out.set(name, await inflateRaw(raw));
    else throw new Error(`지원하지 않는 압축 방식이에요(${method}).`);
  }
  return out;
}

export const decodeUtf8 = (b: Uint8Array): string => dec.decode(b);
