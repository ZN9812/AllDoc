// 본 서버 → 컴파일 일꾼 요청 서명(HMAC-SHA256, COMPILER_SECRET). 일꾼 쪽은 compiler/src/sign.ts 에 같은 규칙이 있다.
//   x-alldoc-signature: t=<밀리초>,v1=<hex(HMAC(비밀값, "<t>.<sha256(본문) hex>"))>
import { createHash, createHmac } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-alldoc-signature';

export function signBody(secret: string, body: Uint8Array, nowMs: number): string {
  const digest = createHash('sha256').update(body).digest('hex');
  const mac = createHmac('sha256', secret).update(`${nowMs}.${digest}`).digest('hex');
  return `t=${nowMs},v1=${mac}`;
}
