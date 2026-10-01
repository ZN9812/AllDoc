import { z } from 'zod';
import { DOC_KINDS } from './doc';

/** 글자 서식(문단 맨 앞 글자 기준으로 읽는다) */
export const CharStyleSchema = z.object({
  fontFamily: z.string().optional(),
  /** pt 단위 */
  fontSizePt: z.number().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
});
export type CharStyle = z.infer<typeof CharStyleSchema>;

export const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type Align = (typeof ALIGNS)[number];

/** 문단 서식 */
export const ParaStyleSchema = z.object({
  align: z.enum(ALIGNS).optional(),
  /** 줄 간격 퍼센트(160 = 160%) */
  lineSpacingPct: z.number().optional(),
});
export type ParaStyle = z.infer<typeof ParaStyleSchema>;

/** 문서의 문단 하나. index 는 각 편집기 연결부가 정한 번호이고 변경 제안이 이 번호를 가리킨다. */
export const ParagraphInfoSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  char: CharStyleSchema,
  para: ParaStyleSchema,
});
export type ParagraphInfo = z.infer<typeof ParagraphInfoSchema>;

/** AI 와 서식 점검에 넘기는 문서 요약 */
export const DocSummarySchema = z.object({
  kind: z.enum(DOC_KINDS),
  paragraphs: z.array(ParagraphInfoSchema),
  pageCount: z.number().int().optional(),
});
export type DocSummary = z.infer<typeof DocSummarySchema>;

/** 기준 문서(양식)에서 뽑은 서식 요약. 같은 역할의 문단을 묶어서 대표 서식을 담는다. */
export const StyleProfileSchema = z.object({
  source: z.string(),
  groups: z
    .array(
      z.object({
        label: z.string(),
        count: z.number().int(),
        sampleText: z.string(),
        char: CharStyleSchema,
        para: ParaStyleSchema,
      }),
    )
    .max(40),
});
export type StyleProfile = z.infer<typeof StyleProfileSchema>;
