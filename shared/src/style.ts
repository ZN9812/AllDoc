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

/** 본문 밖의 글(머리말·꼬리말·각주·미주) 문단이 어디에 있는지. 본문과 표 칸의 문단에는 없다. */
export const AreaPlaceSchema = z.object({
  kind: z.enum(['header', 'footer', 'footnote', 'endnote']),
  /** 머리말·꼬리말이 적용되는 쪽(양쪽·짝수 쪽·홀수 쪽) */
  pages: z.enum(['both', 'even', 'odd']).optional(),
  /** 각주·미주 번호(1부터, 문서에 달린 순서) */
  number: z.number().int().min(1).optional(),
  /** 구역 번호(1부터). 구역이 둘 이상인 문서에서만 붙는다. */
  section: z.number().int().min(1).optional(),
});
export type AreaPlace = z.infer<typeof AreaPlaceSchema>;

const AREA_NAME: Record<AreaPlace['kind'], string> = { header: '머리말', footer: '꼬리말', footnote: '각주', endnote: '미주' };
const PAGES_NAME: Record<NonNullable<AreaPlace['pages']>, string> = { both: '', even: '짝수 쪽', odd: '홀수 쪽' };

/** 영역의 이름만(번호·쪽 없이). 예: "각주" */
export const areaName = (a: AreaPlace): string => AREA_NAME[a.kind];

/** 사람에게 보여 줄 위치 문구. 예: "머리말", "꼬리말(홀수 쪽)", "각주 3", "머리말 · 구역 2" */
export function areaLabel(a: AreaPlace): string {
  const pages = a.pages ? PAGES_NAME[a.pages] : '';
  const head = `${AREA_NAME[a.kind]}${a.number !== undefined ? ` ${a.number}` : ''}${pages ? `(${pages})` : ''}`;
  return a.section !== undefined ? `${head} · 구역 ${a.section}` : head;
}

/** 문서의 문단 하나. index 는 각 편집기 연결부가 정한 번호이고 변경 제안이 이 번호를 가리킨다. */
export const ParagraphInfoSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  char: CharStyleSchema,
  para: ParaStyleSchema,
  /** 표 칸 안의 문단이면 그 위치. 서식 점검(문서 안 일관성·기준 문서)은 표 밖 본문 문단만 비교한다. */
  cell: CellPlaceSchema.optional(),
  /** 머리말·꼬리말·각주·미주 안의 문단이면 그 위치. 서식 점검은 본문 문단만 비교한다. */
  area: AreaPlaceSchema.optional(),
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

/** 문단이 본문 문단인가(표 칸·머리말·꼬리말·각주·미주 안이 아니라). 서식 점검은 본문 문단만 비교한다. */
export const isBodyParagraph = (p: Pick<ParagraphInfo, 'cell' | 'area'>): boolean => p.cell === undefined && p.area === undefined;

/** 문단의 위치 문구(표 칸이나 머리말·각주 등). 본문 문단이면 undefined. */
export function placeOfParagraph(p: Pick<ParagraphInfo, 'cell' | 'area'>): string | undefined {
  if (p.cell) return placeLabel(p.cell);
  if (p.area) return areaLabel(p.area);
  return undefined;
}
