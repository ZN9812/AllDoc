import type { Op } from '@alldoc/shared';
import type { ApplyFailure, ApplyResult } from './types';

export type OneResult = { ok: true; inverse: Op } | ApplyFailure;

/**
 * 변경 묶음을 순서대로 적용하고, 하나라도 실패하면 이미 적용한 것을 거꾸로 되돌린 뒤 실패를 돌려준다.
 * 성공하면 되돌리기에 쓸 역변경을 "되돌릴 순서"(마지막 것부터)로 돌려준다.
 *
 * 같은 문단을 여러 번 고치는 묶음이라면, 앞의 변경으로 문단의 글이 바뀐 뒤에는 뒤쪽 변경이 가진 "바뀌기 전 글의 지문"이 맞지 않게 된다.
 * 그래서 글이 바뀌면(역변경의 지문이 달라지면) 같은 묶음 안에서 같은 문단을 가리키는 뒤쪽 변경의 지문을 새 지문으로 바꿔 준다.
 */
export async function applyAtomic(applyOne: (op: Op) => Promise<OneResult>, ops: Op[]): Promise<ApplyResult> {
  const todo = [...ops];
  const inverses: Op[] = [];
  for (let i = 0; i < todo.length; i++) {
    const op = todo[i] as Op;
    const r = await applyOne(op);
    if (!r.ok) {
      for (const inv of inverses.reverse()) await applyOne(inv);
      return r;
    }
    inverses.push(r.inverse);
    const before = op.guard;
    const after = r.inverse.guard;
    if (before !== undefined && after !== undefined && before !== after) {
      for (let j = i + 1; j < todo.length; j++) {
        const next = todo[j] as Op;
        if (next.paragraph === op.paragraph && next.guard === before) todo[j] = { ...next, guard: after };
      }
    }
  }
  return { ok: true, inverse: inverses.reverse() };
}

export const unsupported = (message: string): ApplyFailure => ({ ok: false, reason: 'unsupported', message });
export const stale = (message: string): ApplyFailure => ({
  ok: false,
  reason: 'stale',
  message,
});
