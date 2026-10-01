import { describe, expect, it } from 'vitest';
import { createLine } from './line';

/** 밖에서 끝낼 수 있는 일 */
function manual<T>() {
  let done!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    done = resolve;
    fail = reject;
  });
  return { promise, done, fail };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createLine', () => {
  it('한 번에 하나씩, 맡긴 순서대로 실행한다', async () => {
    const line = createLine();
    const log: string[] = [];
    const a = manual<string>();
    const b = manual<string>();

    const ra = line(() => {
      log.push('a 시작');
      return a.promise;
    });
    const rb = line(() => {
      log.push('b 시작');
      return b.promise;
    });
    await tick();
    expect(log).toEqual(['a 시작']); // a 가 끝나기 전에는 b 가 시작하지 않는다.

    a.done('A');
    expect(await ra).toBe('A');
    await tick();
    expect(log).toEqual(['a 시작', 'b 시작']);

    b.done('B');
    expect(await rb).toBe('B');
  });

  it('앞의 일이 실패해도 다음 일은 그대로 실행하고, 실패는 맡긴 쪽에만 돌려준다', async () => {
    const line = createLine();
    const first = line(() => Promise.reject(new Error('첫 일 실패')));
    const second = line(() => Promise.resolve('둘째 일 성공'));
    await expect(first).rejects.toThrow('첫 일 실패');
    await expect(second).resolves.toBe('둘째 일 성공');
  });

  it('일이 동기로 던져도 줄이 막히지 않는다', async () => {
    const line = createLine();
    const first = line(() => {
      throw new Error('바로 던짐');
    });
    const second = line(async () => 2);
    await expect(first).rejects.toThrow('바로 던짐');
    await expect(second).resolves.toBe(2);
  });

  it('줄이 비어 있으면 바로 실행하고, 끝난 뒤에 맡긴 일도 실행한다', async () => {
    const line = createLine();
    expect(await line(async () => 1)).toBe(1);
    expect(await line(async () => 2)).toBe(2);
  });

  it('여러 개를 한꺼번에 맡겨도 겹쳐 실행되지 않는다', async () => {
    const line = createLine();
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, i) =>
      line(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5 * ((i * 7) % 3)));
        order.push(i);
        running--;
        return i;
      }),
    );
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(1);
    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
