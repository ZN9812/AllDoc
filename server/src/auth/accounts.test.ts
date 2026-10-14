import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { AccountStore } from './accounts';

const make = () => new AccountStore(openDb(':memory:'));
const user = { id: 'g:1', name: '홍길동', email: 'hong@example.com' };

describe('사용자 계정', () => {
  it('처음 로그인하면 만들고, 다시 로그인하면 이름·이메일·시각만 갱신한다', () => {
    const a = make();
    const first = a.login(user, 100);
    expect(first).toMatchObject({ id: 'g:1', email: 'hong@example.com', createdAt: 100, lastLoginAt: 100, status: 'active', role: 'user', sessionVersion: 1, deletedAt: null });
    const second = a.login({ ...user, name: '홍길순' }, 200);
    expect(second).toMatchObject({ name: '홍길순', createdAt: 100, lastLoginAt: 200, sessionVersion: 1 });
  });

  it('세션 버전을 올리면 새 버전을 돌려준다', () => {
    const a = make();
    a.login(user, 1);
    expect(a.bumpSession('g:1')).toBe(2);
    expect(a.get('g:1')?.sessionVersion).toBe(2);
    expect(a.bumpSession('g:없음')).toBeNull();
  });

  it('탈퇴하면 이메일·이름을 지우고 세션 버전을 올린다. 같은 계정으로 다시 로그인하면 새로 가입한 것으로 본다', () => {
    const a = make();
    a.login(user, 1);
    a.agree('g:1', 'v1', 2);
    a.setRole('g:1', 'admin');
    expect(a.markDeleted('g:1', 10)).toBe(true);
    expect(a.get('g:1')).toMatchObject({ email: null, name: null, deletedAt: 10, sessionVersion: 2 });
    expect(a.markDeleted('g:1', 11)).toBe(false);
    const back = a.login(user, 20);
    expect(back).toMatchObject({ email: 'hong@example.com', createdAt: 20, deletedAt: null, role: 'user', termsVersion: null, age14Confirmed: false, sessionVersion: 3 });
  });

  it('차단·동의·찾기', () => {
    const a = make();
    a.login(user, 1);
    a.login({ id: 'g:2', name: null, email: 'other@example.com' }, 2);
    expect(a.setStatus('g:1', 'banned')).toBe(true);
    expect(a.login(user, 3).status).toBe('banned');
    a.agree('g:2', 'v2', 5);
    expect(a.get('g:2')).toMatchObject({ termsVersion: 'v2', agreedAt: 5, age14Confirmed: true });
    expect(a.find('HONG@example.com').map((x) => x.id)).toEqual(['g:1']);
    expect(a.find('g:2').map((x) => x.id)).toEqual(['g:2']);
  });
});
