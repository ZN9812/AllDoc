import { z } from 'zod';

/** 하단·정책 화면에 보여 줄 운영 정보(GET /api/site). 값은 운영자가 서버 설정으로 넣은 그대로다. */
export const BusinessInfoSchema = z.object({
  /** 상호 */
  name: z.string().nullable(),
  /** 대표자 */
  owner: z.string().nullable(),
  /** 사업자등록번호 */
  registrationNo: z.string().nullable(),
  /** 통신판매업 신고번호 */
  mailOrderNo: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** 개인정보 보호책임자 */
  privacyOfficer: z.string().nullable(),
  /** 호스팅 제공자 */
  hosting: z.string().nullable(),
});
export type BusinessInfo = z.infer<typeof BusinessInfoSchema>;

/** 정책 문서 종류. 주소는 /terms · /privacy · /refund */
export const POLICY_NAMES = ['terms', 'privacy', 'refund'] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];
export const POLICY_TITLES: Record<PolicyName, string> = { terms: '이용약관', privacy: '개인정보처리방침', refund: '환불정책' };

export const SiteInfoSchema = z.object({
  /** 비공개 베타(초대받은 사람만 로그인) */
  beta: z.boolean(),
  /** 모든 항목이 비어 있으면 null(하단에 보이지 않음) */
  business: BusinessInfoSchema.nullable(),
  /** 문의 창구. 설정하지 않았으면 null */
  contact: z.object({ email: z.string().nullable(), url: z.string().nullable() }).nullable(),
  /** 운영자가 정책 파일을 넣었는지(false 면 그 화면은 "준비 중") */
  policies: z.object({ terms: z.boolean(), privacy: z.boolean(), refund: z.boolean() }),
});
export type SiteInfo = z.infer<typeof SiteInfoSchema>;

export const PolicyResponseSchema = z.object({
  name: z.enum(POLICY_NAMES),
  title: z.string(),
  /** 마크다운 전문. 파일이 없으면 null("준비 중") */
  markdown: z.string().nullable(),
});
export type PolicyResponse = z.infer<typeof PolicyResponseSchema>;
