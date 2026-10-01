import { describe, expect, it } from 'vitest';
import { relativeTime } from './time';

const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('상대 시간', () => {
  const now = at(2026, 10, 1, 15, 30);

  it('1분 안은 방금 전, 시계가 앞서도 방금 전', () => {
    expect(relativeTime(now - 30_000, now)).toBe('방금 전');
    expect(relativeTime(now + 5_000, now)).toBe('방금 전');
  });

  it('분과 시간 단위', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5분 전');
    expect(relativeTime(at(2026, 10, 1, 12, 30), now)).toBe('3시간 전');
  });

  it('어제, 올해 날짜, 지난해 날짜', () => {
    expect(relativeTime(at(2026, 9, 30, 23, 0), now)).toBe('어제');
    expect(relativeTime(at(2026, 9, 12), now)).toBe('9월 12일');
    expect(relativeTime(at(2025, 12, 31), now)).toBe('2025년 12월 31일');
  });

  it('자정을 넘기면 한 시간 전이어도 어제', () => {
    const justAfterMidnight = at(2026, 10, 1, 0, 20);
    expect(relativeTime(at(2026, 9, 30, 23, 40), justAfterMidnight)).toBe('40분 전');
    expect(relativeTime(at(2026, 9, 30, 21, 0), justAfterMidnight)).toBe('어제');
  });
});
