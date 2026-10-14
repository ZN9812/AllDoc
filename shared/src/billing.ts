// 요금제와 권한(웹·서버 공용). 결제(M5)는 아직 없고, 지금은 기본 요금제와 관리자 수동 부여만 있다.
// 컴파일·저장 용량 한도는 그 기능(docs/LATEX.md, M6)을 넣을 때 더한다.
import { z } from 'zod';
import { MAX_DOC_CHARS } from './limits';

export const PlanLimitsSchema = z
  .object({
    /** 하루 AI 요청 수(null 이면 제한 없음) */
    aiRequestsPerDay: z.number().int().min(0).nullable(),
    /** 한 달(APP_TIMEZONE 기준 달력 월) AI 요청 수(null 이면 제한 없음) */
    aiRequestsPerMonth: z.number().int().min(0).nullable(),
    /** 요청 한 번에 보낼 수 있는 문서 글자 수(MAX_DOC_CHARS 이하) */
    aiMaxDocChars: z.number().int().min(1).max(MAX_DOC_CHARS),
    /** 숨은 안전 상한: 한 사용자의 한 달 AI 원가(마이크로달러). 광고하지 않는다. null 이면 없음 */
    aiCostCapMicroUsdPerMonth: z.number().int().min(0).nullable(),
  })
  .strict();
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export const PlanSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/, '요금제 id 는 영어 소문자·숫자·_·- 만 쓸 수 있어요'),
    /** 화면에 보이는 이름 */
    name: z.string().min(1).max(40),
    limits: PlanLimitsSchema,
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;

/** anonymous: 로그인 없이 쓰는 설치(AUTH_MODE=none) · default: 기본 요금제 · override: 관리자가 수동으로 준 요금제 */
export const ENTITLEMENT_SOURCES = ['anonymous', 'default', 'override'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

export const PlanInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  source: z.enum(ENTITLEMENT_SOURCES),
  /** 수동 부여의 끝(밀리초). 없으면 null */
  validUntil: z.number().int().nullable(),
  aiRequestsPerDay: z.number().int().nullable(),
  aiRequestsPerMonth: z.number().int().nullable(),
});
export type PlanInfo = z.infer<typeof PlanInfoSchema>;
