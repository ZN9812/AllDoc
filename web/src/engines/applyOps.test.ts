import { textGuard, type Op } from '@alldoc/shared';
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

/** 문단 글을 들고 있고, 변경 때 지문(guard)을 확인하는 대상. 글을 바꾸면 되돌릴 변경에 "바뀐 글의 지문"을 담는다. */
function paragraphs(texts: string[]) {
  const cur = [...texts];
  const applyOne = async (op: Op): Promise<OneResult> => {
    if (op.type !== 'replaceText') return stale('unsupported');
    const text = cur[op.paragraph] as string;
    if (op.guard !== undefined && op.guard !== textGuard(text)) return stale('지문이 달라요');
    const at = text.indexOf(op.find);
    if (at < 0) return stale('글을 찾을 수 없어요');
    cur[op.paragraph] = text.slice(0, at) + op.replace + text.slice(at + op.find.length);
    return { ok: true, inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, guard: textGuard(cur[op.paragraph] as string) } };
  };
  return { applyOne, cur };
}
const swap = (paragraph: number, find: string, replace: string, text: string): Op => ({ type: 'replaceText', paragraph, find, replace, guard: textGuard(text) });

describe('같은 문단을 여러 번 고치는 묶음', () => {
  const ORIGINAL = '몇일 뒤에 할려고 해요';

  it('앞의 변경으로 글이 바뀌어도 뒤쪽 변경이 지문 때문에 거절되지 않는다', async () => {
    const t = paragraphs([ORIGINAL]);
    const r = await applyAtomic(t.applyOne, [swap(0, '몇일', '며칠', ORIGINAL), swap(0, '할려고', '하려고', ORIGINAL)]);
    expect(r.ok).toBe(true);
    expect(t.cur[0]).toBe('며칠 뒤에 하려고 해요');
  });

  it('돌려받은 역변경으로 처음 글로 돌아간다', async () => {
    const t = paragraphs([ORIGINAL]);
    const r = await applyAtomic(t.applyOne, [swap(0, '몇일', '며칠', ORIGINAL), swap(0, '할려고', '하려고', ORIGINAL)]);
    if (!r.ok) throw new Error('적용 실패');
    const back = await applyAtomic(t.applyOne, r.inverse);
    expect(back.ok).toBe(true);
    expect(t.cur[0]).toBe(ORIGINAL);
  });

  it('다른 문단의 지문은 건드리지 않는다', async () => {
    const t = paragraphs([ORIGINAL, '다른 문단']);
    const r = await applyAtomic(t.applyOne, [swap(0, '몇일', '며칠', ORIGINAL), swap(1, '다른', '또 다른', '다른 문단')]);
    expect(r.ok).toBe(true);
    expect(t.cur).toEqual(['며칠 뒤에 할려고 해요', '또 다른 문단']);
  });

  it('처음부터 지문이 맞지 않는 변경은 여전히 거절한다(문서가 이미 바뀐 경우)', async () => {
    const t = paragraphs(['이미 바뀐 글입니다']);
    const r = await applyAtomic(t.applyOne, [swap(0, '바뀐', '고친', ORIGINAL)]);
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect(t.cur[0]).toBe('이미 바뀐 글입니다');
  });
});
