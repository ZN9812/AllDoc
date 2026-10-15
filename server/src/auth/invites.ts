// 비공개 베타 초대. BETA_MODE=invite 이면 초대받은 사람만 로그인·가입할 수 있다(config.ts).
// 초대는 두 가지다: 이메일 허용 목록(구글이 확인한 이메일과 같으면 들어옴)과 초대 코드(로그인할 때 적음).
// 들어온 계정은 users.invite_id 에 그 초대를 남기고, 다음부터는 코드 없이 로그인한다. 초대를 거두면 그 초대로 들어온 계정도 막힌다.
import { randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type InviteKind = 'email' | 'code';

export interface Invite {
  id: number;
  kind: InviteKind;
  /** 이메일(소문자) 또는 코드(대문자, 하이픈·공백 없음) */
  value: string;
  /** 코드를 쓸 수 있는 횟수(null 이면 제한 없음). 이메일 초대는 null */
  maxUses: number | null;
  uses: number;
  expiresAt: number | null;
  note: string | null;
  createdAt: number;
  createdBy: string;
  revokedAt: number | null;
  /** 이 초대로 들어와 지금도 남아 있는 계정 수 */
  members: number;
}

interface Row {
  id: number;
  kind: string;
  value: string;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  note: string | null;
  created_at: number;
  created_by: string;
  revoked_at: number | null;
  members: number;
}

const toInvite = (r: Row): Invite => ({
  id: r.id,
  kind: r.kind === 'email' ? 'email' : 'code',
  value: r.value,
  maxUses: r.max_uses,
  uses: r.uses,
  expiresAt: r.expires_at,
  note: r.note,
  createdAt: r.created_at,
  createdBy: r.created_by,
  revokedAt: r.revoked_at,
  members: r.members,
});

/** 헷갈리기 쉬운 글자(0·O·1·I·L)를 뺀 코드 글자 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-Z0-9]{6,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 사용자가 적은 코드를 저장 형식으로: 대문자, 공백·하이픈 없앰 */
export function normalizeCode(raw: string): string {
  return raw.normalize('NFKC').toUpperCase().replace(/[\s-]+/g, '');
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 새 초대 코드(10글자). 보여 줄 때는 5글자씩 하이픈으로 나눈다. */
export function newInviteCode(): string {
  let s = '';
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

export const displayCode = (code: string): string => (code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code);

const SELECT = `SELECT i.*, (SELECT COUNT(*) FROM users u WHERE u.invite_id = i.id AND u.deleted_at IS NULL) AS members FROM invites i`;

export class InviteStore {
  constructor(private readonly db: DatabaseSync) {}

  get(id: number): Invite | null {
    const r = this.db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as Row | undefined;
    return r ? toInvite(r) : null;
  }

  /** 이메일을 허용 목록에 넣는다. 이미 살아 있는 같은 이메일이 있으면 Error */
  addEmail(rawEmail: string, opts: { expiresAt: number | null; note: string | null; actor: string; now: number }): Invite {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_RE.test(email)) throw new Error(`이메일 형식이 아니에요: ${rawEmail}`);
    return this.insert('email', email, null, opts);
  }

  /** 초대 코드를 만든다. code 가 없으면 무작위로 만든다. */
  addCode(rawCode: string | null, opts: { maxUses: number | null; expiresAt: number | null; note: string | null; actor: string; now: number }): Invite {
    const code = rawCode === null ? newInviteCode() : normalizeCode(rawCode);
    if (!CODE_RE.test(code)) throw new Error('초대 코드는 영문 대문자·숫자 6–40자여야 해요(하이픈·공백은 무시).');
    return this.insert('code', code, opts.maxUses, opts);
  }

  private insert(kind: InviteKind, value: string, maxUses: number | null, opts: { expiresAt: number | null; note: string | null; actor: string; now: number }): Invite {
    try {
      const r = this.db
        .prepare('INSERT INTO invites (kind, value, max_uses, expires_at, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .get(kind, value, maxUses, opts.expiresAt, opts.note, opts.now, opts.actor) as { id: number };
      return this.get(r.id) as Invite;
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) throw new Error(`이미 있는 초대예요: ${kind === 'code' ? displayCode(value) : value}`);
      throw e;
    }
  }

  /** 최근 것부터. 거둔 초대는 all 일 때만 */
  list(all = false): Invite[] {
    return (this.db.prepare(`${SELECT} ${all ? '' : 'WHERE i.revoked_at IS NULL'} ORDER BY i.id DESC`).all() as unknown as Row[]).map(toInvite);
  }

  /**
   * 초대를 거둔다: 앞으로 그 초대로 들어올 수 없고, 그 초대로 들어온 계정도 초대 없음으로 돌린다(베타 중에는 다음 요청부터 막힘).
   * 거둔 계정 번호 목록을 돌려준다. 없거나 이미 거둔 초대면 null.
   */
  revoke(id: number, now: number): string[] | null {
    const ok = Number(this.db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, id).changes) > 0;
    if (!ok) return null;
    const users = (this.db.prepare('UPDATE users SET invite_id = NULL WHERE invite_id = ? RETURNING id').all(id) as Array<{ id: string }>).map((r) => r.id);
    return users;
  }

  /** 허용 목록에서 이 이메일의 살아 있는 초대를 찾아 쓴 횟수를 올린다. 없으면 null */
  redeemEmail(rawEmail: string, now: number): number | null {
    const r = this.db
      .prepare(
        `UPDATE invites SET uses = uses + 1
         WHERE kind = 'email' AND value = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) RETURNING id`,
      )
      .get(normalizeEmail(rawEmail), now) as { id: number } | undefined;
    return r?.id ?? null;
  }

  /** 초대 코드를 한 번 쓴다(만료·횟수 확인과 증가를 한 문장으로). 쓸 수 없으면 null */
  redeemCode(rawCode: string, now: number): number | null {
    const code = normalizeCode(rawCode);
    if (!CODE_RE.test(code)) return null;
    const r = this.db
      .prepare(
        `UPDATE invites SET uses = uses + 1
         WHERE kind = 'code' AND value = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses)
         RETURNING id`,
      )
      .get(code, now) as { id: number } | undefined;
    return r?.id ?? null;
  }

  /** 계정에 들어온 초대를 남긴다 */
  admit(userId: string, inviteId: number): void {
    this.db.prepare('UPDATE users SET invite_id = ? WHERE id = ?').run(inviteId, userId);
  }
}
