import type { Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { applyAtomic, stale, type OneResult } from './applyOps';

/** 숫자 하나를 들고 있다가 "더하기" 변경을 적용하는 간단한 대상 */
function counter(start: number, failAt?: number) {
  let value = start;
  const log: number[] = [];
  const applyOne = async (op: Op): Promise<OneResult> => {
    if (op.type !== 'replaceText') return stale('unsupported');
    const n = Number(op.replace);
    if (failAt !== undefined && n === failAt) return stale('실패');
    value += n;
    log.push(n);
    return { ok: true, inverse: { type: 'replaceText', paragraph: 0, find: '', replace: String(-n) } };
  };
  return { applyOne, get value() { return value; }, log };
}
const add = (n: number): Op => ({ type: 'replaceText', paragraph: 0, find: '', replace: String(n) });

describe('변경 묶음 적용', () => {
  it('모두 성공하면 되돌릴 변경을 마지막 것부터 돌려준다', async () => {
    const c = counter(0);
    const r = await applyAtomic(c.applyOne, [add(1), add(2), add(3)]);
    expect(r.ok).toBe(true);
    expect(c.value).toBe(6);
    if (r.ok) expect(r.inverse.map((o) => (o.type === 'replaceText' ? o.replace : ''))).toEqual(['-3', '-2', '-1']);
  });

  it('돌려받은 역변경을 적용하면 처음 상태로 돌아간다', async () => {
    const c = counter(10);
    const r = await applyAtomic(c.applyOne, [add(5), add(7)]);
    if (!r.ok) throw new Error('적용 실패');
    await applyAtomic(c.applyOne, r.inverse);
    expect(c.value).toBe(10);
  });

  it('중간에 실패하면 이미 적용한 변경을 모두 되돌리고 실패를 알린다', async () => {
    const c = counter(0, 3);
    const r = await applyAtomic(c.applyOne, [add(1), add(2), add(3), add(4)]);
    expect(r).toMatchObject({ ok: false, reason: 'stale', message: '실패' });
    expect(c.value).toBe(0);
    expect(c.log).not.toContain(4);
  });

  it('변경이 없으면 성공이고 되돌릴 것도 없다', async () => {
    const c = counter(0);
    expect(await applyAtomic(c.applyOne, [])).toEqual({ ok: true, inverse: [] });
  });
});
