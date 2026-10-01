import { describe, expect, it } from 'vitest';
import { dayKey, QuotaStore, quotaOf } from './quota';

describe('하루가 바뀌는 시각', () => {
  it('한국 시간 자정을 기준으로 날짜를 나눈다', () => {
    // 2026-09-30 14:59:59 UTC = 2026-09-30 23:59:59 KST, 1초 뒤가 10월 1일 0시(KST)
    expect(dayKey(new Date('2026-09-30T14:59:59Z'), 'Asia/Seoul')).toBe('2026-09-30');
    expect(dayKey(new Date('2026-09-30T15:00:00Z'), 'Asia/Seoul')).toBe('2026-10-01');
    expect(dayKey(new Date('2026-09-30T15:00:00Z'), 'UTC')).toBe('2026-09-30');
  });
});

describe('사용 횟수 한도', () => {
  const make = () => new QuotaStore(':memory:');

  it('한도까지만 쓸 수 있고, 넘으면 거절한다', () => {
    const q = make();
    for (let i = 1; i <= 3; i++) expect(q.consume('u1', '2026-10-01', 3)).toEqual({ ok: true, used: i });
    expect(q.consume('u1', '2026-10-01', 3)).toEqual({ ok: false, used: 3 });
    expect(q.used('u1', '2026-10-01')).toBe(3);
    q.close();
  });

  it('사용자와 날짜별로 따로 센다', () => {
    const q = make();
    q.consume('u1', '2026-10-01', 1);
    expect(q.consume('u1', '2026-10-01', 1).ok).toBe(false);
    expect(q.consume('u2', '2026-10-01', 1).ok).toBe(true);
    expect(q.consume('u1', '2026-10-02', 1).ok).toBe(true);
    q.close();
  });

  it('돌려주면 다시 쓸 수 있고, 0 아래로 내려가지 않는다', () => {
    const q = make();
    q.consume('u1', '2026-10-01', 1);
    q.refund('u1', '2026-10-01');
    expect(q.used('u1', '2026-10-01')).toBe(0);
    q.refund('u1', '2026-10-01');
    q.refund('nobody', '2026-10-01');
    expect(q.used('u1', '2026-10-01')).toBe(0);
    expect(q.consume('u1', '2026-10-01', 1).ok).toBe(true);
    q.close();
  });

  it('지난 기록만 지운다', () => {
    const q = make();
    q.consume('u1', '2026-09-01', 5);
    q.consume('u1', '2026-10-01', 5);
    q.prune('2026-09-20');
    expect(q.used('u1', '2026-09-01')).toBe(0);
    expect(q.used('u1', '2026-10-01')).toBe(1);
    q.close();
  });

  it('남은 횟수 계산', () => {
    expect(quotaOf(2, 5)).toEqual({ limit: 5, used: 2, remaining: 3 });
    expect(quotaOf(7, 5).remaining).toBe(0);
  });
});
