// 관리자 명령줄 도구. 서버와 같은 환경(설정·DATA_DIR)에서 돌린다. 모든 바꾸는 명령은 관리 기록(audit_log)에 남는다.
//   node --disable-warning=ExperimentalWarning server/dist/admin.js <명령> ...
// 컨테이너에서는 docker compose exec alldoc node --disable-warning=ExperimentalWarning server/dist/admin.js <명령>
import { join } from 'node:path';
import type { AuditLog } from './audit';
import type { AccountStore, Account } from './auth/accounts';
import { displayCode, type Invite, type InviteStore } from './auth/invites';
import { deleteAccount } from './auth/deletion';
import { monthStart, type EntitlementStore } from './billing/entitlements';
import type { Config } from './config';
import type { LedgerStore } from './ledger';
import type { TexStore } from './tex/store';
import { dayKey, type QuotaStore } from './quota';

export const ADMIN_HELP = `사용법: admin.js <명령>
  plans                                  요금제 목록
  user <번호|이메일>                      사용자 찾기(요금제·오늘·이번 달 사용량·이번 달 원가)
  grant <번호> <요금제> [--days N] [--note 메모]   요금제를 수동으로 주기(--days 가 없으면 회수할 때까지)
  revoke <번호>                           수동으로 준 요금제 거두기
  ban <번호> | unban <번호>                차단(모든 쿠키도 무효) · 차단 풀기
  logout-all <번호>                       모든 기기에서 로그아웃시키기
  role <번호> admin|user                  역할 바꾸기
  delete <번호> --yes                     탈퇴시키기(되돌릴 수 없음)
  audit [번호]                            최근 관리 기록
  invite add email <이메일> [--days N] [--note 메모]          비공개 베타 이메일 허용 목록에 넣기
  invite add code [코드] [--uses N] [--days N] [--note 메모]  초대 코드 만들기(코드를 안 적으면 무작위)
  invite list [--all]                     초대 목록(--all 이면 거둔 것도)
  invite revoke <초대 번호>                초대 거두기(그 초대로 들어온 계정도 베타 중에는 막힘)`;

export interface AdminContext {
  config: Pick<Config, 'plans' | 'timezone' | 'sessionSecret'> & { beta?: boolean };
  accounts: AccountStore;
  entitlements: EntitlementStore;
  quota: QuotaStore;
  ledger: LedgerStore;
  /** 탈퇴할 때 컴파일하려고 올린 파일 기록도 지운다 */
  tex?: TexStore;
  audit: AuditLog;
  /** 비공개 베타 초대(invite 명령) */
  invites?: InviteStore;
  now: number;
  actor: string;
}

const positiveInt = (raw: string | undefined, name: string): number | null => {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!(Number.isInteger(n) && n > 0)) throw new Error(`${name} 는 1 이상의 정수여야 해요.`);
  return n;
};

function inviteLine(i: Invite, now: number): string {
  const what = i.kind === 'email' ? `이메일 ${i.value}` : `코드 ${displayCode(i.value)}`;
  const uses = i.kind === 'code' ? ` · 사용 ${i.uses}${i.maxUses === null ? '' : `/${i.maxUses}`}회` : '';
  const state = i.revokedAt !== null ? ' · 거둠' : i.expiresAt !== null && i.expiresAt <= now ? ' · 만료' : '';
  return `#${i.id} ${what}${uses} · 들어온 계정 ${i.members} · ${i.expiresAt === null ? '기한 없음' : `${fmt(i.expiresAt)} 까지`}${state}${i.note ? ` · ${i.note}` : ''}`;
}

const fmt = (ms: number | null) => (ms === null ? '-' : new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** 명령을 실행하고 보여 줄 글을 돌려준다. 잘못된 명령·없는 사용자는 Error 를 던진다. */
export function runAdmin(args: string[], ctx: AdminContext): string {
  const [cmd, a1, a2] = args;
  const { accounts, entitlements, audit, now, actor } = ctx;
  const day = dayKey(new Date(now), ctx.config.timezone);
  const need = (id: string | undefined): Account => {
    if (!id) throw new Error(`사용자 번호를 적어 주세요.\n${ADMIN_HELP}`);
    const a = accounts.get(id);
    if (!a) throw new Error(`없는 사용자예요: ${id} (user 명령으로 찾아 보세요)`);
    return a;
  };
  const log = (action: string, target: string, detail?: object) => audit.record({ at: now, actor, action, target, detail: detail ? JSON.stringify(detail) : null });

  switch (cmd) {
    case 'plans':
      return ctx.config.plans.list
        .map((p) => {
          const l = p.limits;
          const n = (v: number | null) => (v === null ? '제한 없음' : String(v));
          return `${p.id}${p.id === ctx.config.plans.defaultPlanId ? '(기본)' : ''} ${p.name}: 하루 ${n(l.aiRequestsPerDay)} · 월 ${n(l.aiRequestsPerMonth)} · 글자 ${l.aiMaxDocChars} · 월 원가 상한 ${l.aiCostCapMicroUsdPerMonth === null ? '없음' : usd(l.aiCostCapMicroUsdPerMonth)}`;
        })
        .join('\n');
    case 'user': {
      if (!a1) throw new Error('찾을 번호나 이메일을 적어 주세요.');
      const found = accounts.find(a1);
      if (found.length === 0) return '찾지 못했어요.';
      return found
        .map((a) => {
          const e = entitlements.resolve(a.id, now);
          const month = monthStart(day);
          return [
            `${a.id} ${a.email ?? '(이메일 없음)'} ${a.name ?? ''}`.trim(),
            `  상태 ${a.status}${a.deletedAt ? ` · 탈퇴 ${fmt(a.deletedAt)}` : ''} · 역할 ${a.role} · 가입 ${fmt(a.createdAt)} · 마지막 로그인 ${fmt(a.lastLoginAt)}`,
            `  요금제 ${e.planId}(${e.source}${e.validUntil ? `, ${fmt(e.validUntil)} 까지` : ''}) · 약관 ${a.termsVersion ?? '동의 전'}`,
            `  오늘 ${ctx.quota.used(a.id, day)}회 · 이번 달 ${ctx.quota.usedBetween(a.id, month, day)}회 · 이번 달 원가 ${usd(ctx.ledger.userCost(a.id, month, day))}`,
          ].join('\n');
        })
        .join('\n');
    }
    case 'grant': {
      const a = need(a1);
      if (!a2) throw new Error(`요금제 id 를 적어 주세요(${entitlements.planIds().join(', ')}).`);
      const daysRaw = flag(args, '--days');
      const days = daysRaw === undefined ? null : Number(daysRaw);
      if (days !== null && !(Number.isInteger(days) && days > 0)) throw new Error('--days 는 1 이상의 정수여야 해요.');
      const until = days === null ? null : now + days * 86_400_000;
      const note = flag(args, '--note') ?? null;
      entitlements.grant(a.id, a2, until, note, actor, now);
      log('plan.grant', a.id, { plan: a2, validUntil: until, note });
      return `${a.id} 에게 ${a2} 를 줬어요(${until === null ? '회수할 때까지' : `${fmt(until)} 까지`}).`;
    }
    case 'revoke': {
      const a = need(a1);
      const ok = entitlements.revoke(a.id);
      if (ok) log('plan.revoke', a.id);
      return ok ? `${a.id} 의 수동 요금제를 거뒀어요.` : `${a.id} 에게 수동으로 준 요금제가 없어요.`;
    }
    case 'ban':
    case 'unban': {
      const a = need(a1);
      accounts.setStatus(a.id, cmd === 'ban' ? 'banned' : 'active');
      if (cmd === 'ban') accounts.bumpSession(a.id);
      log(`account.${cmd}`, a.id);
      return cmd === 'ban' ? `${a.id} 를 차단했어요(모든 쿠키 무효).` : `${a.id} 의 차단을 풀었어요.`;
    }
    case 'logout-all': {
      const a = need(a1);
      accounts.bumpSession(a.id);
      log('account.logout_all', a.id);
      return `${a.id} 를 모든 기기에서 로그아웃시켰어요.`;
    }
    case 'role': {
      const a = need(a1);
      if (a2 !== 'admin' && a2 !== 'user') throw new Error('역할은 admin 또는 user 예요.');
      accounts.setRole(a.id, a2);
      log('account.role', a.id, { role: a2 });
      return `${a.id} 의 역할을 ${a2} 로 바꿨어요.`;
    }
    case 'delete': {
      const a = need(a1);
      if (!args.includes('--yes')) throw new Error('되돌릴 수 없어요. 정말 지우려면 --yes 를 붙여 주세요.');
      const r = deleteAccount({ accounts, entitlements, ledger: ctx.ledger, tex: ctx.tex, audit, secret: ctx.config.sessionSecret }, a.id, actor, now);
      return r ? `${a.id} 를 탈퇴시켰어요(원장 ${r.ledgerRows}줄 가명화).` : `${a.id} 는 이미 탈퇴했어요.`;
    }
    case 'audit':
      return (
        audit
          .recent(a1 ?? null)
          .map((e) => `${fmt(e.at)} ${e.actor} ${e.action} ${e.target ?? ''} ${e.detail ?? ''}`.trimEnd())
          .join('\n') || '기록이 없어요.'
      );
    case 'invite': {
      const inv = ctx.invites;
      if (!inv) throw new Error('초대 저장소가 없어요.');
      const off = ctx.config.beta === false ? '\n(참고: 지금 BETA_MODE 가 꺼져 있어 초대는 BETA_MODE=invite 로 켰을 때부터 효력이 있어요.)' : '';
      if (a1 === 'list') {
        const rows = inv.list(args.includes('--all'));
        return (rows.length === 0 ? '초대가 없어요.' : rows.map((i) => inviteLine(i, now)).join('\n')) + off;
      }
      if (a1 === 'add') {
        const days = positiveInt(flag(args, '--days'), '--days');
        const expiresAt = days === null ? null : now + days * 86_400_000;
        const note = flag(args, '--note') ?? null;
        const third = args[3] !== undefined && !args[3].startsWith('--') ? args[3] : null;
        let created: Invite;
        if (a2 === 'email') {
          if (!third) throw new Error('넣을 이메일을 적어 주세요.');
          created = inv.addEmail(third, { expiresAt, note, actor, now });
        } else if (a2 === 'code') {
          created = inv.addCode(third, { maxUses: positiveInt(flag(args, '--uses'), '--uses'), expiresAt, note, actor, now });
        } else {
          throw new Error(`invite add 다음에 email 또는 code 를 적어 주세요.\n${ADMIN_HELP}`);
        }
        log('invite.add', `invite:${created.id}`, { kind: created.kind, maxUses: created.maxUses, expiresAt, note });
        return `초대를 만들었어요: ${inviteLine(created, now)}${off}`;
      }
      if (a1 === 'revoke') {
        const id = positiveInt(a2, '초대 번호');
        if (id === null) throw new Error('거둘 초대 번호를 적어 주세요(invite list 로 확인).');
        const users = inv.revoke(id, now);
        if (users === null) return `#${id} 는 없거나 이미 거둔 초대예요.`;
        log('invite.revoke', `invite:${id}`, { users });
        return `#${id} 초대를 거뒀어요. 이 초대로 들어온 계정 ${users.length}개는 베타 중에는 다시 초대받아야 들어올 수 있어요.`;
      }
      throw new Error(`invite 다음에 add · list · revoke 중 하나를 적어 주세요.\n${ADMIN_HELP}`);
    }
    default:
      throw new Error(ADMIN_HELP);
  }
}

// 직접 실행했을 때만 돈다(시험에서 불러올 때는 돌지 않는다).
if (process.argv[1] && /admin\.(js|ts)$/.test(process.argv[1])) {
  const { loadDotEnv } = await import('./dotenv');
  loadDotEnv();
  const { loadConfig, ConfigError } = await import('./config');
  const { openDb } = await import('./db');
  const { AccountStore } = await import('./auth/accounts');
  const { EntitlementStore } = await import('./billing/entitlements');
  const { QuotaStore } = await import('./quota');
  const { LedgerStore } = await import('./ledger');
  const { AuditLog } = await import('./audit');
  const { TexStore } = await import('./tex/store');
  const { InviteStore } = await import('./auth/invites');
  let db;
  try {
    const config = loadConfig();
    db = openDb(join(config.dataDir, 'alldoc.sqlite'));
    const out = runAdmin(process.argv.slice(2), {
      config,
      accounts: new AccountStore(db),
      entitlements: new EntitlementStore(db, config),
      quota: new QuotaStore(db),
      ledger: new LedgerStore(db),
      tex: new TexStore(db, config.dataDir),
      audit: new AuditLog(db),
      invites: new InviteStore(db),
      now: Date.now(),
      actor: `admin-cli:${process.env.USER ?? process.env.HOSTNAME ?? 'unknown'}`,
    });
    console.log(out);
  } catch (e) {
    console.error(e instanceof ConfigError ? `설정 문제:\n  - ${e.problems.join('\n  - ')}` : e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
