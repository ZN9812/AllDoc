// e2e 용 DOCX 시험 파일. 만드는 법은 web/src/engines/docx/fixtures.ts 에 있다.
import { DOCX_MIME, makeDocxBytes, SAMPLE_DOCX_PARAS, type DocxAreas, type ParaSpec, type TableSpec } from '../web/src/engines/docx/fixtures';
import { decodeUtf8, readZipFiles } from '../web/src/engines/docx/zip';
import type { Upload } from './helpers';

export { SAMPLE_DOCX_PARAS, type DocxAreas, type ParaSpec, type TableSpec };

export function makeDocx(name = 'sample.docx', items: Array<ParaSpec | TableSpec> = SAMPLE_DOCX_PARAS, areas?: DocxAreas): Upload {
  return { name, mimeType: DOCX_MIME, buffer: makeDocxBytes(items, areas) };
}

export interface DocxPara {
  text: string;
  /** 글이 든 칸마다 적힌 글자 크기(pt). 적혀 있지 않은 칸은 빠진다. */
  sizes: number[];
  /** 글이 든 칸마다 적힌 한글(동아시아) 글꼴 이름. 없으면 영문 글꼴 이름 */
  fonts: string[];
  bold: boolean;
  align?: string;
  /** 줄 간격 퍼센트(배수 방식일 때만) */
  linePct?: number;
}

const unescapeXml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const attr = (xml: string, name: string): string | undefined => new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1];

/** 내려받은 DOCX 에서 문단별 글과 서식을 읽는다(시험 확인용. 문서 안의 표 칸 문단도 순서대로 포함). part 는 읽을 파일(기본은 본문). */
export async function readDocx(bytes: Buffer, part = 'word/document.xml'): Promise<DocxPara[]> {
  const files = await readZipFiles(new Uint8Array(bytes), [part]);
  const xml = decodeUtf8(files.get(part) ?? new Uint8Array());
  const out: DocxPara[] = [];
  for (const m of xml.matchAll(/<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    const runs = [...p.matchAll(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g)].map((r) => r[0]).filter((r) => r.includes('<w:t'));
    const text = runs.map((r) => [...r.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => unescapeXml(t[1] ?? '')).join('')).join('');
    const sizes: number[] = [];
    const fonts: string[] = [];
    let bold = runs.length > 0;
    for (const r of runs) {
      const sz = /<w:sz w:val="(\d+)"/.exec(r)?.[1];
      if (sz) sizes.push(Number(sz) / 2);
      const rFonts = /<w:rFonts [^>]*\/>/.exec(r)?.[0];
      const face = rFonts ? (attr(rFonts, 'w:eastAsia') ?? attr(rFonts, 'w:ascii')) : undefined;
      if (face) fonts.push(face);
      const b = /<w:b(?: w:val="([^"]*)")?\/>/.exec(r);
      if (!b || b[1] === '0' || b[1] === 'false') bold = false;
    }
    const ppr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p)?.[0] ?? '';
    const spacing = /<w:spacing [^>]*\/>/.exec(ppr)?.[0];
    const line = spacing && (attr(spacing, 'w:lineRule') ?? 'auto') === 'auto' ? attr(spacing, 'w:line') : undefined;
    out.push({
      text,
      sizes,
      fonts,
      bold,
      align: /<w:jc w:val="([^"]*)"/.exec(ppr)?.[1],
      linePct: line ? Math.round(Number(line) / 2.4) : undefined,
    });
  }
  return out;
}

/** 내려받은 DOCX 안의 파일 하나를 글로 읽는다(없으면 undefined). */
export async function readDocxPart(bytes: Buffer, name: string): Promise<string | undefined> {
  const files = await readZipFiles(new Uint8Array(bytes), [name]);
  const part = files.get(name);
  return part ? decodeUtf8(part) : undefined;
}

/**
 * 시험용 Word 문서의 머리말·꼬리말·각주. 오탈자가 머리말("오랫만"), 본문("몇일"), 각주("되요"), 꼬리말("할려고")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.
 * 각주 글은 Word 처럼 공백으로 시작한다(맨 앞의 각주 번호 표시 뒤).
 */
export const DOCX_AREA_SAMPLE = {
  body: ['휴가 신청서', '몇일 동안 쉬겠습니다.'],
  header: '머리말 오랫만 입니다',
  footer: '꼬리말 할려고 합니다',
  note: ' 각주 되요 입니다',
  /** 오탈자를 모두 고친 뒤의 모습 */
  fixed: { body: ['휴가 신청서', '며칠 동안 쉬겠습니다.'], header: '머리말 오랜만 입니다', footer: '꼬리말 하려고 합니다', note: ' 각주 돼요 입니다' },
};

/**
 * 머리말·꼬리말(쪽 번호 필드가 붙는다)·각주가 든 시험 문서.
 * headerSize 가 있으면 머리말을 그 크기(pt)의 굵은 글씨로 해서 본문과 서식이 다른 머리말을 흉내 낸다.
 * extraBody 가 있으면 본문 끝에 그만큼 보통 문단을 더한다(서식 점검이 본문 문단 수를 보고 판단하기 때문).
 * endnote 가 true 이면 각주 대신 같은 글을 미주로 단다.
 */
export function makeDocxWithAreas(name = 'areas.docx', opts: { headerSize?: number; extraBody?: number; endnote?: boolean } = {}): Upload {
  const font = { font: '맑은 고딕', sizePt: 10 } as const;
  const kind = opts.endnote ? 'endnote' : 'footnote';
  const body: ParaSpec[] = [
    { text: DOCX_AREA_SAMPLE.body[0] as string, ...font },
    { text: DOCX_AREA_SAMPLE.body[1] as string, ...font, noteRef: { kind, id: 1 } },
    ...Array.from({ length: opts.extraBody ?? 0 }, (_, i): ParaSpec => ({ text: `본문 ${i + 1}번째 문장입니다.`, ...font })),
  ];
  const areas: DocxAreas = {
    header: [{ text: DOCX_AREA_SAMPLE.header, ...(opts.headerSize ? { sizePt: opts.headerSize, bold: true } : {}) }],
    footer: [{ text: DOCX_AREA_SAMPLE.footer, align: 'right', pageField: true }],
    ...(opts.endnote ? { endnotes: [[{ text: DOCX_AREA_SAMPLE.note }]] } : { footnotes: [[{ text: DOCX_AREA_SAMPLE.note }]] }),
  };
  return makeDocx(name, body, areas);
}

export interface DocxAreasRead {
  headers: string[];
  /** 머리말 문단마다 글자 크기(pt) */
  headerSizes: number[];
  footers: string[];
  footnotes: string[];
  endnotes: string[];
  /** 꼬리말 파일의 XML(쪽 번호 필드가 남았는지 볼 때) */
  footerXml: string;
  /** 본문 파일의 XML(각주·미주 표시가 남았는지 볼 때) */
  bodyXml: string;
}

/** 내려받은 DOCX 의 머리말·꼬리말·각주·미주 글(글이 든 문단만)을 읽는다. */
export async function readDocxAreas(bytes: Buffer): Promise<DocxAreasRead> {
  const texts = async (part: string): Promise<DocxPara[]> => (await readDocx(bytes, part)).filter((p) => p.text !== '');
  const header = await texts('word/header1.xml');
  return {
    headers: header.map((p) => p.text),
    headerSizes: header.map((p) => p.sizes[0] as number),
    footers: (await texts('word/footer1.xml')).map((p) => p.text),
    footnotes: (await texts('word/footnotes.xml')).map((p) => p.text),
    endnotes: (await texts('word/endnotes.xml')).map((p) => p.text),
    footerXml: (await readDocxPart(bytes, 'word/footer1.xml')) ?? '',
    bodyXml: (await readDocxPart(bytes, 'word/document.xml')) ?? '',
  };
}
