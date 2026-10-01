import type { Op } from '@alldoc/shared';
import type { ApplyFailure, ApplyResult } from './types';

export type OneResult = { ok: true; inverse: Op } | ApplyFailure;

/**
 * 변경 묶음을 순서대로 적용하고, 하나라도 실패하면 이미 적용한 것을 거꾸로 되돌린 뒤 실패를 돌려준다.
 * 성공하면 되돌리기에 쓸 역변경을 "되돌릴 순서"(마지막 것부터)로 돌려준다.
 */
export async function applyAtomic(applyOne: (op: Op) => Promise<OneResult>, ops: Op[]): Promise<ApplyResult> {
  const inverses: Op[] = [];
  for (const op of ops) {
    const r = await applyOne(op);
    if (!r.ok) {
      for (const inv of inverses.reverse()) await applyOne(inv);
      return r;
    }
    inverses.push(r.inverse);
  }
  return { ok: true, inverse: inverses.reverse() };
}

export const unsupported = (message: string): ApplyFailure => ({ ok: false, reason: 'unsupported', message });
export const stale = (message: string): ApplyFailure => ({
  ok: false,
  reason: 'stale',
  message,
});
