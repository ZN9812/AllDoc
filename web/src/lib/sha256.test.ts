// @vitest-environment node
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const nodeHex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();

describe('sha256(crypto.subtle 이 없을 때 쓰는 대체)', () => {
  it('표준 시험 벡터(FIPS 180-2)와 같다', () => {
    expect(hex(sha256(new Uint8Array()))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(enc.encode('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('덧붙임이 블록을 넘는 길이(55·56·63·64·65바이트 등)를 포함해 0~200바이트에서 node:crypto 와 같다', () => {
    for (let n = 0; n <= 200; n++) {
      const data = randomBytes(n);
      expect(hex(sha256(data)), `${n}바이트`).toBe(nodeHex(data));
    }
  });

  it('큰 파일(그림 크기, 약 3MB)도 node:crypto 와 같다', () => {
    const data = randomBytes(3 * 1024 * 1024 + 7);
    expect(hex(sha256(data))).toBe(nodeHex(data));
  });

  it('더 큰 버퍼의 일부(byteOffset 이 0 이 아닌 보기)만 해시한다', () => {
    const whole = randomBytes(300);
    const view = whole.subarray(17, 250);
    expect(hex(sha256(view))).toBe(nodeHex(view));
  });
});
