// 탈퇴 처리. 화면(POST /api/account/delete)과 관리자 CLI 가 같이 쓴다.
// 순서(docs/PRODUCT.md "탈퇴와 보관"): 계정의 이메일·이름 지우기와 세션 무효화 → 수동 부여 회수 → 원장 가명화 → 관리 기록.
// 하루·월 사용 횟수 기록(usage)은 지우지 않는다: 탈퇴 뒤 같은 계정으로 다시 가입해 무료 한도를 되돌리지 못하게 하려는 것이며, 62일 뒤 자동으로 지워진다.
import { createHmac } from 'node:crypto';
import type { AuditLog } from '../audit';
import type { EntitlementStore } from '../billing/entitlements';
import type { LedgerStore } from '../ledger';
import type { AccountStore } from './accounts';

/** 원장에 남길 가명. 같은 사용자는 같은 가명이 되지만 원래 번호로 되돌릴 수 없다(비밀값이 있어야 계산 가능). */
export function deletedAlias(userId: string, secret: string): string {
  return `del:${createHmac('sha256', secret).update(`deleted-user:${userId}`).digest('base64url').slice(0, 16)}`;
}

export interface DeletionDeps {
  accounts: AccountStore;
  entitlements: EntitlementStore;
  ledger?: LedgerStore;
  audit: AuditLog;
  secret: string;
}

/** 탈퇴시킨다. 이미 탈퇴했거나 없는 계정이면 null. */
export function deleteAccount(d: DeletionDeps, userId: string, actor: string, now: number): { ledgerRows: number } | null {
  return d.accounts.transaction(() => {
    if (!d.accounts.markDeleted(userId, now)) return null;
    d.entitlements.revoke(userId);
    const alias = deletedAlias(userId, d.secret);
    const ledgerRows = d.ledger?.pseudonymize(userId, alias) ?? 0;
    // 관리 기록에도 원래 번호 대신 가명을 남긴다.
    d.audit.record({ at: now, actor: actor === userId ? alias : actor, action: 'account.delete', target: alias, detail: JSON.stringify({ ledgerRows }) });
    return { ledgerRows };
  });
}
