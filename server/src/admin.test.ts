import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPILE_LIMITS } from '@alldoc/shared';
import { ADMIN_HELP, runAdmin, type AdminContext } from './admin';
import { AuditLog } from './audit';
import { AccountStore } from './auth/accounts';
import { deletedAlias } from './auth/deletion';
import { InviteStore } from './auth/invites';
import { EntitlementStore } from './billing/entitlements';
import { openDb } from './db';
import { LedgerStore } from './ledger';
import { QuotaStore } from './quota';

const NOW = Date.parse('2026-10-14T03:00:00Z');
const limits = (perDay: number | null) => ({ aiRequestsPerDay: perDay, aiRequestsPerMonth: null, aiMaxDocChars: 120_000, aiCostCapMicroUsdPerMonth: null, ...DEFAULT_COMPILE_LIMITS });
const config = {
  plans: { defaultPlanId: 'free', list: [{ id: 'free', name: '무료', limits: limits(5) }, { id: 'pro', name: '프로', limits: limits(null) }] },
  timezone: 'Asia/Seoul',
  sessionSecret: 's'.repeat(40),
};

function make(): AdminContext & { db: ReturnType<typeof openDb> } {
  const db = openDb(':memory:');
  const ctx = {
    db,
    config,
    accounts: new AccountStore(db),
    entitlements: new EntitlementStore(db, config),
    quota: new QuotaStore(db),
    ledger: new LedgerStore(db),
    audit: new AuditLog(db),
    invites: new InviteStore(db),
    now: NOW,
    actor: 'admin-cli:시험',
  };
  ctx.accounts.login({ id: 'g:1', name: '홍길동', email: 'hong@example.com' }, NOW - 1000);
  return ctx;
}

describe('관리자 명령줄 도구', () => {
  it('요금제 목록과 사용자 찾기', () => {
    const ctx = make();
    expect(runAdmin(['plans'], ctx)).toContain('free(기본) 무료: 하루 5');
    ctx.quota.consume('g:1', '2026-10-14', 5);
    const out = runAdmin(['user', 'HONG@example.com'], ctx);
    expect(out).toContain('g:1 hong@example.com 홍길동');
    expect(out).toContain('요금제 free(default)');
    expect(out).toContain('오늘 1회');
    expect(runAdmin(['user', 'nobody@example.com'], ctx)).toBe('찾지 못했어요.');
  });

  it('요금제를 주고(기간 포함) 거두며, 모두 관리 기록에 남는다', () => {
    const ctx = make();
    expect(runAdmin(['grant', 'g:1', 'pro', '--days', '30', '--note', '베타'], ctx)).toContain('2026-11-13');
    expect(ctx.entitlements.resolve('g:1', NOW)).toMatchObject({ planId: 'pro', source: 'override', validUntil: NOW + 30 * 86_400_000 });
    expect(runAdmin(['revoke', 'g:1'], ctx)).toContain('거뒀어요');
    expect(ctx.entitlements.resolve('g:1', NOW).planId).toBe('free');
    expect(ctx.audit.recent('g:1').map((e) => e.action)).toEqual(['plan.revoke', 'plan.grant']);
    expect(ctx.audit.recent('g:1')[1]).toMatchObject({ actor: 'admin-cli:시험', detail: expect.stringContaining('"note":"베타"') });
  });

  it('차단하면 세션도 무효가 되고, 풀 수 있다', () => {
    const ctx = make();
    runAdmin(['ban', 'g:1'], ctx);
    expect(ctx.accounts.get('g:1')).toMatchObject({ status: 'banned', sessionVersion: 2 });
    runAdmin(['unban', 'g:1'], ctx);
    expect(ctx.accounts.get('g:1')?.status).toBe('active');
  });

  it('탈퇴는 --yes 가 있어야 하고, 원장을 가명으로 바꾼다', () => {
    const ctx = make();
    ctx.ledger.recordAi({ at: 0, day: '2026-10-14', userId: 'g:1', planId: 'free', task: 'chat', provider: 'mock', modelRequested: 'mock', usage: undefined, docChars: 1, proposals: 0, dropped: 0, ms: 1, outcome: 'ok' });
    expect(() => runAdmin(['delete', 'g:1'], ctx)).toThrow('--yes');
    expect(runAdmin(['delete', 'g:1', '--yes'], ctx)).toContain('원장 1줄 가명화');
    expect(ctx.db.prepare('SELECT user_id FROM ai_events').get()).toEqual({ user_id: deletedAlias('g:1', config.sessionSecret) });
    expect(runAdmin(['delete', 'g:1', '--yes'], ctx)).toContain('이미 탈퇴');
  });

  it('잘못된 명령·없는 사용자·없는 요금제·잘못된 기간은 오류로 알린다', () => {
    const ctx = make();
    expect(() => runAdmin(['nope'], ctx)).toThrow(ADMIN_HELP);
    expect(() => runAdmin(['grant', 'g:없음', 'pro'], ctx)).toThrow('없는 사용자');
    expect(() => runAdmin(['grant', 'g:1', 'gold'], ctx)).toThrow('없는 요금제');
    expect(() => runAdmin(['grant', 'g:1', 'pro', '--days', '0'], ctx)).toThrow('--days');
    expect(() => runAdmin(['role', 'g:1', 'root'], ctx)).toThrow('admin 또는 user');
  });

  describe('비공개 베타 초대(invite)', () => {
    it('이메일·코드 초대를 만들고 목록에서 보며, 모두 관리 기록에 남는다', () => {
      const ctx = make();
      expect(runAdmin(['invite', 'add', 'email', 'Guest@Example.com', '--note', '1차'], ctx)).toContain('#1 이메일 guest@example.com');
      const out = runAdmin(['invite', 'add', 'code', '--uses', '10', '--days', '14'], ctx);
      const code = /코드 ([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(out)?.[1];
      expect(code).toBeTruthy();
      expect(out).toContain('사용 0/10회');
      expect(out).toContain('2026-10-28');
      expect(runAdmin(['invite', 'add', 'code', 'LAB-2026'], ctx)).toContain('코드 LAB2026');
      const list = runAdmin(['invite', 'list'], ctx);
      expect(list.split('\n')).toHaveLength(3);
      expect(list.split('\n')[0]).toMatch(/^#3 코드 LAB2026/);
      expect(ctx.audit.recent(null).map((e) => e.action)).toEqual(['invite.add', 'invite.add', 'invite.add']);
    });

    it('거두면 그 초대로 들어온 계정이 초대 없음이 되고, 목록에서 빠진다(--all 이면 보인다)', () => {
      const ctx = make();
      runAdmin(['invite', 'add', 'code', 'TEAM0001'], ctx);
      ctx.invites!.admit('g:1', 1);
      expect(runAdmin(['invite', 'list'], ctx)).toContain('들어온 계정 1');
      expect(runAdmin(['invite', 'revoke', '1'], ctx)).toContain('계정 1개');
      expect(ctx.accounts.get('g:1')?.inviteId).toBeNull();
      expect(runAdmin(['invite', 'list'], ctx)).toBe('초대가 없어요.');
      expect(runAdmin(['invite', 'list', '--all'], ctx)).toContain('거둠');
      expect(runAdmin(['invite', 'revoke', '1'], ctx)).toContain('이미 거둔');
      expect(ctx.audit.recent('invite:1')[0]).toMatchObject({ action: 'invite.revoke', detail: '{"users":["g:1"]}' });
    });

    it('겹치는 초대·잘못된 값은 오류로 알리고, 베타가 꺼져 있으면 알려 준다', () => {
      const ctx = make();
      runAdmin(['invite', 'add', 'email', 'a@example.com'], ctx);
      expect(() => runAdmin(['invite', 'add', 'email', 'A@example.com'], ctx)).toThrow('이미 있는 초대');
      expect(() => runAdmin(['invite', 'add', 'email', 'not-an-email'], ctx)).toThrow('이메일 형식');
      expect(() => runAdmin(['invite', 'add', 'code', 'ab'], ctx)).toThrow('6–40자');
      expect(() => runAdmin(['invite', 'add', 'code', '--uses', '0'], ctx)).toThrow('--uses');
      expect(() => runAdmin(['invite', 'add', 'phone'], ctx)).toThrow('email 또는 code');
      expect(() => runAdmin(['invite', 'revoke'], ctx)).toThrow('초대 번호');
      expect(() => runAdmin(['invite'], ctx)).toThrow('add · list · revoke');
      expect(runAdmin(['invite', 'list'], { ...ctx, config: { ...config, beta: false } })).toContain('BETA_MODE 가 꺼져');
    });
  });
});
