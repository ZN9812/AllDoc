// e2e 용 DOCX 시험 파일. 만드는 법은 web/src/engines/docx/fixtures.ts 에 있다.
import { DOCX_MIME, makeDocxBytes, SAMPLE_DOCX_PARAS, type ParaSpec, type TableSpec } from '../web/src/engines/docx/fixtures';
import { decodeUtf8, readZipFiles } from '../web/src/engines/docx/zip';
import type { Upload } from './helpers';

export { SAMPLE_DOCX_PARAS, type ParaSpec, type TableSpec };

export function makeDocx(name = 'sample.docx', items: Array<ParaSpec | TableSpec> = SAMPLE_DOCX_PARAS): Upload {
  return { name, mimeType: DOCX_MIME, buffer: makeDocxBytes(items) };
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

/** 내려받은 DOCX 에서 문단별 글과 서식을 읽는다(시험 확인용. 문서 안의 표 칸 문단도 순서대로 포함). */
export async function readDocx(bytes: Buffer): Promise<DocxPara[]> {
  const files = await readZipFiles(new Uint8Array(bytes), ['word/document.xml']);
  const xml = decodeUtf8(files.get('word/document.xml') ?? new Uint8Array());
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
