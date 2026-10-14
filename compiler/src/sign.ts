// 본 서버의 요청 서명 확인(규칙은 server/src/tex/sign.ts 와 같다).
//   x-alldoc-signature: t=<밀리초>,v1=<hex(HMAC-SHA256(비밀값, "<t>.<sha256(본문) hex>"))>
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-alldoc-signature';
/** 서명 시각과 지금의 차이 허용 범위(시계 차이와 재전송 대비) */
export const MAX_SKEW_MS = 5 * 60_000;

export function signBody(secret: string, body: Uint8Array, nowMs: number): string {
  const digest = createHash('sha256').update(body).digest('hex');
  return `t=${nowMs},v1=${createHmac('sha256', secret).update(`${nowMs}.${digest}`).digest('hex')}`;
}

export function verifyBody(secret: string, body: Uint8Array, header: string | undefined, nowMs: number): boolean {
  if (!header) return false;
  const m = /^t=(\d{1,16}),v1=([0-9a-f]{64})$/.exec(header);
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowMs - t) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(signBody(secret, body, t).split('v1=')[1] as string, 'hex');
  const got = Buffer.from(m[2] as string, 'hex');
  return expected.length === got.length && timingSafeEqual(expected, got);
}
