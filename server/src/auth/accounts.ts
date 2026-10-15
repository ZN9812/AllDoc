// 사용자 계정. 로그인하면 행을 만들거나 갱신하고, 요청마다 기본키로 한 번 조회해 탈퇴·차단·세션 무효화를 확인한다.
// 세션 쿠키는 서명만 하고 서버에 목록을 두지 않으므로, "모든 기기에서 로그아웃"은 계정의 세션 버전을 올려 옛 쿠키를 무효로 만든다.
import type { DatabaseSync } from 'node:sqlite';
import type { SessionUser } from './session';

export type AccountStatus = 'active' | 'banned';
export type AccountRole = 'user' | 'admin';

export interface Account {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: number;
  lastLoginAt: number;
  status: AccountStatus;
  role: AccountRole;
  sessionVersion: number;
  termsVersion: string | null;
  agreedAt: number | null;
  age14Confirmed: boolean;
  deletedAt: number | null;
  /** 비공개 베타에 들어온 초대(invites.id). 초대 없이 만든 계정이나 초대를 거둔 계정은 null */
  inviteId: number | null;
}

interface Row {
  id: string;
  email: string | null;
  name: string | null;
  created_at: number;
  last_login_at: number;
  status: string;
  role: string;
  session_version: number;
  terms_version: string | null;
  agreed_at: number | null;
  age14_confirmed: number | null;
  deleted_at: number | null;
  invite_id: number | null;
}

const toAccount = (r: Row): Account => ({
  id: r.id,
  email: r.email,
  name: r.name,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
  status: r.status === 'banned' ? 'banned' : 'active',
  role: r.role === 'admin' ? 'admin' : 'user',
  sessionVersion: r.session_version,
  termsVersion: r.terms_version,
  agreedAt: r.agreed_at,
  age14Confirmed: r.age14_confirmed === 1,
  deletedAt: r.deleted_at,
  inviteId: r.invite_id ?? null,
});

export class AccountStore {
  private readonly getStmt;
  private readonly insertStmt;
  private readonly loginStmt;
  private readonly revivedStmt;
  private readonly bumpStmt;
  private readonly statusStmt;
  private readonly roleStmt;
  private readonly agreeStmt;
  private readonly deleteStmt;
  private readonly findStmt;

  constructor(private readonly db: DatabaseSync) {
    this.getStmt = db.prepare('SELECT * FROM users WHERE id = ?');
    this.insertStmt = db.prepare('INSERT INTO users (id, email, name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING');
    this.loginStmt = db.prepare('UPDATE users SET email = ?, name = ?, last_login_at = ? WHERE id = ? AND deleted_at IS NULL');
    // 탈퇴한 계정으로 다시 로그인하면 새로 가입한 것으로 본다(동의·역할은 처음부터, 세션 버전은 계속 올린다).
    this.revivedStmt = db.prepare(
      `UPDATE users SET email = ?, name = ?, created_at = ?, last_login_at = ?, deleted_at = NULL, role = 'user',
         terms_version = NULL, agreed_at = NULL, age14_confirmed = NULL, session_version = session_version + 1
       WHERE id = ? AND deleted_at IS NOT NULL`,
    );
    this.bumpStmt = db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ? RETURNING session_version');
    this.statusStmt = db.prepare('UPDATE users SET status = ? WHERE id = ?');
    this.roleStmt = db.prepare('UPDATE users SET role = ? WHERE id = ?');
    this.agreeStmt = db.prepare('UPDATE users SET terms_version = ?, agreed_at = ?, age14_confirmed = 1 WHERE id = ?');
    this.deleteStmt = db.prepare(
      'UPDATE users SET email = NULL, name = NULL, deleted_at = ?, session_version = session_version + 1 WHERE id = ? AND deleted_at IS NULL',
    );
    this.findStmt = db.prepare('SELECT * FROM users WHERE id = ? OR email = ? COLLATE NOCASE ORDER BY last_login_at DESC LIMIT 20');
  }

  get(id: string): Account | null {
    const r = this.getStmt.get(id) as Row | undefined;
    return r ? toAccount(r) : null;
  }

  /** 로그인할 때: 처음이면 만들고, 있으면 이름·이메일·마지막 로그인 시각을 갱신한다. 차단된 계정도 행은 돌려준다(막는 것은 부르는 쪽). */
  login(user: SessionUser, now: number): Account {
    this.insertStmt.run(user.id, user.email, user.name, now, now);
    this.revivedStmt.run(user.email, user.name, now, now, user.id);
    this.loginStmt.run(user.email, user.name, now, user.id);
    return this.get(user.id) as Account;
  }

  /** 세션 버전을 올려 이 계정의 모든 쿠키를 무효로 만든다. 새 버전을 돌려준다. */
  bumpSession(id: string): number | null {
    const r = this.bumpStmt.get(id) as { session_version: number } | undefined;
    return r?.session_version ?? null;
  }

  setStatus(id: string, status: AccountStatus): boolean {
    return Number(this.statusStmt.run(status, id).changes) > 0;
  }

  setRole(id: string, role: AccountRole): boolean {
    return Number(this.roleStmt.run(role, id).changes) > 0;
  }

  /** 약관(과 만 14세 이상) 동의를 기록한다. */
  agree(id: string, termsVersion: string, now: number): void {
    this.agreeStmt.run(termsVersion, now, id);
  }

  /** 탈퇴: 이메일·이름을 지우고 모든 쿠키를 무효로 만든다. 행은 남긴다(같은 계정으로 다시 가입하면 새로 시작). */
  markDeleted(id: string, now: number): boolean {
    return Number(this.deleteStmt.run(now, id).changes) > 0;
  }

  /** 관리자 CLI: 번호 또는 이메일로 찾는다. */
  find(query: string): Account[] {
    return (this.findStmt.all(query, query) as unknown as Row[]).map(toAccount);
  }

  /** 여러 저장 모듈을 한 번에 바꿀 때(탈퇴 등) 쓰는 트랜잭션 */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}
