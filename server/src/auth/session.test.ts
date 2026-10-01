import { describe, expect, it } from 'vitest';
import { newSessionToken, open, pkceChallenge, readSession, safeNext, seal, sign, unsign } from './session';

const SECRET = 'a'.repeat(40);
const NOW = Date.UTC(2026, 9, 1);

describe('서명', () => {
  it('서명한 값은 확인되고, 한 글자라도 바뀌면 거절된다', () => {
    const s = sign('hello', SECRET);
    expect(unsign(s, SECRET)).toBe('hello');
    expect(unsign(s.replace('hello', 'hellp'), SECRET)).toBeNull();
    expect(unsign(s, 'b'.repeat(40))).toBeNull();
    expect(unsign('no-dot', SECRET)).toBeNull();
    expect(unsign('hello.', SECRET)).toBeNull();
  });
});

describe('로그인 세션', () => {
  const user = { id: 'g:123', name: '홍길동', email: 'a@b.c' };

  it('만든 세션을 다시 읽는다', () => {
    expect(readSession(newSessionToken(user, SECRET, NOW), SECRET, NOW + 1000)).toEqual(user);
  });

  it('만료되면 읽지 못한다', () => {
    const t = newSessionToken(user, SECRET, NOW);
    expect(readSession(t, SECRET, NOW + 31 * 86_400_000)).toBeNull();
  });

  it('내용을 바꾸거나 다른 비밀로 만든 것은 읽지 못한다', () => {
    const t = newSessionToken(user, SECRET, NOW);
    const [payload, mac] = t.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ u: { ...user, id: 'g:999' }, exp: 9_999_999_999 })).toString('base64url');
    expect(readSession(`${forged}.${mac}`, SECRET, NOW)).toBeNull();
    expect(readSession(`${payload}.${mac}`, 'c'.repeat(40), NOW)).toBeNull();
    expect(readSession(undefined, SECRET, NOW)).toBeNull();
    expect(readSession('garbage', SECRET, NOW)).toBeNull();
  });

  it('로그인 시도 정보(state)도 같은 방식으로 만료된다', () => {
    const t = seal({ state: 's', verifier: 'v', next: '/' }, SECRET, NOW, 600);
    expect(open(t, SECRET, NOW + 1000)).toMatchObject({ state: 's' });
    expect(open(t, SECRET, NOW + 601_000)).toBeNull();
  });
});

describe('로그인 뒤 돌아갈 주소', () => {
  it('이 사이트 안의 경로만 허용한다', () => {
    expect(safeNext('/edit/abc')).toBe('/edit/abc');
    expect(safeNext('/docs?x=1')).toBe('/docs?x=1');
    expect(safeNext(undefined)).toBe('/');
    expect(safeNext('')).toBe('/');
  });

  it('다른 사이트나 API 로 보내는 주소는 홈으로 바꾼다', () => {
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'evil', '/api/auth/logout', '/a\nb']) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});

describe('PKCE', () => {
  it('RFC 7636 예시 값과 같은 도전 값을 만든다', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
