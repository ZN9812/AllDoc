import { z } from 'zod';
import { ALIGNS, PROPOSAL_CATEGORIES } from '@alldoc/shared';

/**
 * AI 가 채우는 출력 모양. 모델의 "구조화된 출력"은 서로 다른 모양의 합집합(유니온)에 약하므로,
 * 변경(op)은 필드가 모두 있는 평평한 모양으로 받고 쓰지 않는 필드는 null 로 둔다.
 * 서버가 이것을 문서와 대조해 shared 의 엄격한 Op/Proposal 로 바꾼다.
 */
export const RawOpSchema = z.object({
  type: z.enum(['replaceText', 'setCharStyle', 'setParaStyle']),
  paragraph: z.number().int(),
  find: z.string().nullable(),
  replace: z.string().nullable(),
  fontFamily: z.string().nullable(),
  fontSizePt: z.number().nullable(),
  bold: z.boolean().nullable(),
  italic: z.boolean().nullable(),
  underline: z.boolean().nullable(),
  align: z.enum(ALIGNS).nullable(),
  lineSpacingPct: z.number().nullable(),
});
export type RawOp = z.infer<typeof RawOpSchema>;

export const RawProposalSchema = z.object({
  category: z.enum(PROPOSAL_CATEGORIES),
  title: z.string(),
  description: z.string(),
  before: z.string(),
  after: z.string(),
  ops: z.array(RawOpSchema),
});
export type RawProposal = z.infer<typeof RawProposalSchema>;

export const AiOutputSchema = z.object({
  reply: z.string(),
  proposals: z.array(RawProposalSchema),
});
export type AiOutput = z.infer<typeof AiOutputSchema>;
