// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from './uuid';

// 사내망 http 주소처럼 "안전하지 않은 주소"에서는 브라우저가 crypto.randomUUID 를 주지 않고 getRandomValues 만 준다.
const real = globalThis.crypto;
const stubCrypto = (parts: Record<string, unknown>) => vi.stubGlobal('crypto', parts);
const fillWith = (byte: number) => (a: Uint8Array) => a.fill(byte);

afterEach(() => vi.unstubAllGlobals());

describe('uuid', () => {
  it('crypto.randomUUID 가 있으면 그 값을 그대로 쓴다', () => {
    stubCrypto({ randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(uuid()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('randomUUID 가 없으면 getRandomValues 로 만들고, 바이트가 모두 0 이어도 버전(4)·변형(8) 자리를 채운다', () => {
    stubCrypto({ getRandomValues: fillWith(0) });
    expect(uuid()).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('바이트가 모두 255 여도 버전·변형 자리가 규격(4, 8~b)에 맞는다', () => {
    stubCrypto({ getRandomValues: fillWith(255) });
    expect(uuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('진짜 난수로 만든 값은 규격에 맞고 서로 다르다', () => {
    stubCrypto({ getRandomValues: real.getRandomValues.bind(real) });
    const ids = Array.from({ length: 200 }, () => uuid());
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
