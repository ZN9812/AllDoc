import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { EntitlementStore, monthStart } from './entitlements';

const limits = (perDay: number | null) => ({ aiRequestsPerDay: perDay, aiRequestsPerMonth: null, aiMaxDocChars: 120_000, aiCostCapMicroUsdPerMonth: null });
const config = {
  plans: {
    defaultPlanId: 'free',
    list: [
      { id: 'free', name: '무료', limits: limits(5) },
      { id: 'pro', name: '프로', limits: limits(100) },
    ],
  },
};
const make = () => new EntitlementStore(openDb(':memory:'), config);

describe('권한(요금제) 고르기', () => {
  it('부여가 없으면 기본 요금제, 로그인 없는 설치는 한도 없음', () => {
    const e = make();
    expect(e.resolve('g:1', 0)).toMatchObject({ planId: 'free', source: 'default', limits: { aiRequestsPerDay: 5 } });
    expect(e.resolve(null, 0)).toMatchObject({ source: 'anonymous', limits: { aiRequestsPerDay: null, aiRequestsPerMonth: null } });
  });

  it('관리자 수동 부여가 기본 요금제보다 먼저이고, 기간이 끝나면 기본으로 돌아간다', () => {
    const e = make();
    e.grant('g:1', 'pro', 1_000, '베타 시험자', 'admin-cli', 0);
    expect(e.resolve('g:1', 999)).toMatchObject({ planId: 'pro', source: 'override', validUntil: 1_000, limits: { aiRequestsPerDay: 100 } });
    expect(e.resolve('g:1', 1_000).planId).toBe('free');
    expect(e.resolve('g:2', 0).planId).toBe('free');
  });

  it('기간 없는 부여는 회수할 때까지 유지되고, 다시 부여하면 덮어쓴다', () => {
    const e = make();
    e.grant('g:1', 'pro', null, null, 'admin-cli', 0);
    expect(e.resolve('g:1', 9e15).planId).toBe('pro');
    e.grant('g:1', 'free', null, '되돌림', 'admin-cli', 1);
    expect(e.override('g:1')).toMatchObject({ planId: 'free', note: '되돌림' });
    expect(e.revoke('g:1')).toBe(true);
    expect(e.revoke('g:1')).toBe(false);
  });

  it('없는 요금제는 부여할 수 없고, 설정에서 사라진 요금제의 부여는 기본으로 돌아간다', () => {
    const db = openDb(':memory:');
    expect(() => new EntitlementStore(db, config).grant('g:1', 'gold', null, null, 'x', 0)).toThrow('없는 요금제');
    new EntitlementStore(db, config).grant('g:1', 'pro', null, null, 'x', 0);
    const shrunk = new EntitlementStore(db, { plans: { defaultPlanId: 'free', list: [config.plans.list[0]!] } });
    expect(shrunk.resolve('g:1', 0)).toMatchObject({ planId: 'free', source: 'default' });
  });

  it('이번 달 첫날', () => {
    expect(monthStart('2026-10-14')).toBe('2026-10-01');
  });
});
