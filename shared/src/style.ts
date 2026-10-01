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
  /** 되돌리기용: 언어별 글꼴 7칸. 편집기 연결부가 만들며 AI 는 쓰지 않는다. */
  fontFaces: z.array(z.string()).length(7).optional(),
  /** 되돌리기용: DOCX 의 글꼴 칸(영문·한글(동아시아) 등). 편집기 연결부가 만들며 AI 는 쓰지 않는다. */
  rawFonts: z.object({ ascii: z.string().optional(), hAnsi: z.string().optional(), eastAsia: z.string().optional(), cs: z.string().optional() }).optional(),
});
export type CharStyle = z.infer<typeof CharStyleSchema>;

export const ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type Align = (typeof ALIGNS)[number];

/** 문단 서식 */
export const ParaStyleSchema = z.object({
  align: z.enum(ALIGNS).optional(),
  /** 줄 간격 퍼센트(160 = 160%) */
  lineSpacingPct: z.number().optional(),
  /** 되돌리기용: 한글이 쓰던 정렬 이름(distribute 등 4가지에 없는 값 포함). 편집기 연결부가 만들며 AI 는 쓰지 않는다. */
  rawAlign: z.string().optional(),
  /** 되돌리기용: 한글이 쓰던 줄 간격 방식과 값(고정·최소 등 퍼센트가 아닌 방식 포함). */
  rawLineSpacing: z.object({ type: z.string(), value: z.number() }).optional(),
});
export type ParaStyle = z.infer<typeof ParaStyleSchema>;

/** 표 칸 안의 문단이 어디에 있는지(사람이 읽는 위치). 표 밖 문단에는 없다. */
export const CellPlaceSchema = z.object({
  /** 문서 안 표 번호(1부터, 문서 순서로 센다. 표 안의 표도 하나씩 센다) */
  table: z.number().int().min(1),
  /** 칸의 행·열(1부터) */
  row: z.number().int().min(1),
  col: z.number().int().min(1),
  /** 1 = 본문에 놓인 표, 2 = 표 안의 표 … */
  depth: z.number().int().min(1),
});
export type CellPlace = z.infer<typeof CellPlaceSchema>;

/** 사람에게 보여 줄 위치 문구. 예: "표 2 · 3행 1열" */
export const placeLabel = (c: CellPlace): string => `표 ${c.table} · ${c.row}행 ${c.col}열${c.depth > 1 ? ' (표 안의 표)' : ''}`;

/** 문서의 문단 하나. index 는 각 편집기 연결부가 정한 번호이고 변경 제안이 이 번호를 가리킨다. */
export const ParagraphInfoSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  char: CharStyleSchema,
  para: ParaStyleSchema,
  /** 표 칸 안의 문단이면 그 위치. 서식 점검(문서 안 일관성·기준 문서)은 표 밖 문단만 비교한다. */
  cell: CellPlaceSchema.optional(),
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
