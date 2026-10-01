// 서명된 쿠키 세션. 서버에 세션 목록을 두지 않고, 쿠키 값에 HMAC 서명을 붙여 위조를 막는다.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SessionUser {
  /** 구글이면 "g:<sub>", 개발용이면 "dev:<이름>" */
  id: string;
  name: string | null;
  email: string | null;
}

export const SESSION_COOKIE = 'alldoc_session';
export const OAUTH_COOKIE = 'alldoc_oauth';
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;
export const OAUTH_TTL_SEC = 10 * 60;

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

function mac(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

export function sign(value: string, secret: string): string {
  return `${value}.${mac(value, secret).toString('base64url')}`;
}

export function unsign(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1), 'base64url');
  const expected = mac(value, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return value;
}

/** 값(JSON)을 만료 시각과 함께 서명한다. */
export function seal(payload: object, secret: string, nowMs: number, ttlSec: number): string {
  return sign(b64(JSON.stringify({ ...payload, exp: Math.floor(nowMs / 1000) + ttlSec })), secret);
}

/** seal 로 만든 값을 확인한다. 서명이 틀리거나 만료되었으면 null. */
export function open<T extends object>(token: string | undefined, secret: string, nowMs: number): (T & { exp: number }) | null {
  if (!token) return null;
  const value = unsign(token, secret);
  if (value === null) return null;
  try {
    const parsed = JSON.parse(unb64(value)) as T & { exp?: unknown };
    if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < nowMs) return null;
    return parsed as T & { exp: number };
  } catch {
    return null;
  }
}

export function newSessionToken(user: SessionUser, secret: string, nowMs: number): string {
  return seal({ u: user }, secret, nowMs, SESSION_TTL_SEC);
}

export function readSession(token: string | undefined, secret: string, nowMs: number): SessionUser | null {
  const p = open<{ u: SessionUser }>(token, secret, nowMs);
  const u = p?.u;
  if (!u || typeof u.id !== 'string' || u.id.length === 0) return null;
  return { id: u.id, name: typeof u.name === 'string' ? u.name : null, email: typeof u.email === 'string' ? u.email : null };
}

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const pkceChallenge = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

/** 로그인 뒤 돌아갈 곳. 이 사이트 안의 경로만 허용한다(다른 사이트로 보내는 열린 리다이렉트 방지). */
export function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\u0000-\u001f\u007f]/.test(next)) return '/';
  if (next.startsWith('/api/')) return '/';
  return next;
}
