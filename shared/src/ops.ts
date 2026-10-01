import { z } from 'zod';
import { CharStyleSchema, ParaStyleSchema } from './style';

/** 모든 변경이 가지는 공통 칸 */
const OpBase = {
  /**
   * 변경을 만들 때 본 문단 글의 지문(textGuard). 적용할 때 그 문단의 글이 달라졌으면 문서가 바뀐 것이므로 적용하지 않는다.
   * 문단 번호가 밀리거나 문단 내용을 직접 고친 뒤에 엉뚱한 곳이 바뀌는 것을 막는다.
   */
  guard: z.string().optional(),
};

/**
 * 문서에 적용할 수 있는 작은 단위의 변경.
 * 모든 편집기 연결부가 같은 3가지만 구현한다. (모르는 변경은 적용하지 않고 실패로 알린다.)
 */
export const OpSchema = z.discriminatedUnion('type', [
  /**
   * 문단 안의 글을 바꾼다. find 가 문단에 없으면 적용하지 않는다(stale).
   * at 은 바꿀 글이 시작하는 위치 힌트다. 되돌리기(역변경)가 같은 자리를 정확히 가리키도록 적용 결과에 넣어 준다.
   * AI 는 at 을 만들지 않는다.
   */
  z.object({
    ...OpBase,
    type: z.literal('replaceText'),
    paragraph: z.number().int().min(0),
    /** 비어 있으면 at 위치에 끼워 넣는다(삭제를 되돌리는 역변경이 쓴다). AI 가 만든 변경은 비어 있을 수 없다. */
    find: z.string(),
    replace: z.string(),
    at: z.number().int().min(0).optional(),
  }),
  /** 문단 전체의 글자 서식을 바꾼다. */
  z.object({
    ...OpBase,
    type: z.literal('setCharStyle'),
    paragraph: z.number().int().min(0),
    style: CharStyleSchema,
  }),
  /** 문단 서식을 바꾼다. */
  z.object({
    ...OpBase,
    type: z.literal('setParaStyle'),
    paragraph: z.number().int().min(0),
    style: ParaStyleSchema,
  }),
]);
export type Op = z.infer<typeof OpSchema>;

/** 문단 글의 짧은 지문(32비트 FNV-1a, 8자리 16진수). 보안용이 아니라 "글이 바뀌었는지" 가려내는 용도다. */
export function textGuard(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const PROPOSAL_CATEGORIES = ['format', 'spelling', 'wording'] as const;
export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ProposalCategory, string> = {
  format: '서식',
  spelling: '맞춤법',
  wording: '문장',
};

/** AI(또는 서식 점검)가 만든 제안 하나. 사용자가 적용하기 전에는 문서가 바뀌지 않는다. */
export const ProposalSchema = z.object({
  id: z.string(),
  category: z.enum(PROPOSAL_CATEGORIES),
  title: z.string(),
  description: z.string(),
  /** 변경 내역 카드에 보여줄 짧은 앞/뒤 표시 (예: "15pt" → "13pt") */
  before: z.string(),
  after: z.string(),
  ops: z.array(OpSchema).min(1),
});
export type Proposal = z.infer<typeof ProposalSchema>;

/** 제안이 가리키는 문단 번호들(문서에서 표시할 때 쓴다) */
export function proposalParagraphs(p: Pick<Proposal, 'ops'>): number[] {
  return [...new Set(p.ops.map((o) => o.paragraph))].sort((a, b) => a - b);
}
