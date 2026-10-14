// 권한(요금제) 고르기. 우선순위: 관리자 수동 부여(유효 기간 안) → 기본 요금제. 결제(M5)를 넣으면 그 사이에 이용권·구독이 들어간다.
import type { DatabaseSync } from 'node:sqlite';
import { MAX_DOC_CHARS, type EntitlementSource, type Plan, type PlanLimits } from '@alldoc/shared';
import type { Config } from '../config';

export interface Entitlements {
  planId: string;
  planName: string;
  source: EntitlementSource;
  limits: PlanLimits;
  validUntil: number | null;
}

export interface Override {
  userId: string;
  planId: string;
  validUntil: number | null;
  note: string | null;
  createdAt: number;
  createdBy: string;
}

/** 로그인 없이 쓰는 설치(AUTH_MODE=none)는 지금처럼 한도가 없다. */
const ANONYMOUS: Entitlements = {
  planId: 'anonymous',
  planName: '로그인 없음',
  source: 'anonymous',
  limits: { aiRequestsPerDay: null, aiRequestsPerMonth: null, aiMaxDocChars: MAX_DOC_CHARS, aiCostCapMicroUsdPerMonth: null },
  validUntil: null,
};

export class EntitlementStore {
  private readonly getStmt;
  private readonly upsertStmt;
  private readonly deleteStmt;
  private readonly plans: Map<string, Plan>;

  constructor(
    db: DatabaseSync,
    private readonly config: Pick<Config, 'plans'>,
  ) {
    this.plans = new Map(config.plans.list.map((p) => [p.id, p]));
    this.getStmt = db.prepare('SELECT * FROM entitlement_overrides WHERE user_id = ?');
    this.upsertStmt = db.prepare(
      `INSERT INTO entitlement_overrides (user_id, plan_id, valid_until, note, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET plan_id = excluded.plan_id, valid_until = excluded.valid_until, note = excluded.note,
         created_at = excluded.created_at, created_by = excluded.created_by`,
    );
    this.deleteStmt = db.prepare('DELETE FROM entitlement_overrides WHERE user_id = ?');
  }

  planIds(): string[] {
    return [...this.plans.keys()];
  }

  override(userId: string): Override | null {
    const r = this.getStmt.get(userId) as
      | { user_id: string; plan_id: string; valid_until: number | null; note: string | null; created_at: number; created_by: string }
      | undefined;
    return r ? { userId: r.user_id, planId: r.plan_id, validUntil: r.valid_until, note: r.note, createdAt: r.created_at, createdBy: r.created_by } : null;
  }

  /** 관리자 수동 부여. 없는 요금제면 오류. validUntil 이 null 이면 회수할 때까지. */
  grant(userId: string, planId: string, validUntil: number | null, note: string | null, by: string, now: number): void {
    if (!this.plans.has(planId)) throw new Error(`없는 요금제예요: ${planId} (있는 것: ${this.planIds().join(', ')})`);
    this.upsertStmt.run(userId, planId, validUntil, note, now, by);
  }

  revoke(userId: string): boolean {
    return Number(this.deleteStmt.run(userId).changes) > 0;
  }

  /** 이 사용자의 권한. userId 가 null 이면 로그인 없는 설치. 부여된 요금제가 설정에서 사라졌으면 기본 요금제로 돌아간다. */
  resolve(userId: string | null, now: number): Entitlements {
    if (userId === null) return ANONYMOUS;
    const o = this.override(userId);
    if (o && (o.validUntil === null || o.validUntil > now)) {
      const p = this.plans.get(o.planId);
      if (p) return { planId: p.id, planName: p.name, source: 'override', limits: p.limits, validUntil: o.validUntil };
    }
    const d = this.plans.get(this.config.plans.defaultPlanId) as Plan;
    return { planId: d.id, planName: d.name, source: 'default', limits: d.limits, validUntil: null };
  }
}

/** 시간대 기준 이번 달 첫날(YYYY-MM-01). day 는 dayKey 결과(YYYY-MM-DD). */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;
