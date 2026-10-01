// 한글 문서 시험 파일을 @rhwp/core(WASM)로 직접 만들고, 내려받은 파일을 다시 읽어 확인한다.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HwpDocument, initSync } from '@rhwp/core';
import type { Upload } from './helpers';

let ready = false;
function core(): typeof HwpDocument {
  if (!ready) {
    (globalThis as { measureTextWidth?: (font: string, text: string) => number }).measureTextWidth = (font, text) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
      let w = 0;
      for (const ch of text) w += ch.charCodeAt(0) > 0x2000 ? size : size / 2;
      return w;
    };
    initSync({ module: readFileSync(createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm')) });
    ready = true;
  }
  return HwpDocument;
}

export const SAMPLE_LINES = [
  '업무 협조 요청',
  '1. 첫째 항목입니다',
  '2. 둘째 항목입니다',
  '3. 셋째 항목입니다',
  '본문 문장입니다. 몇일 뒤에 만나요. 할려고 했어요.',
];

/**
 * 시험용 한글 문서: 제목(18pt 굵게, 가운데), 번호 항목 3개(셋째만 13pt, 나머지 10pt), 오탈자가 든 본문.
 * 실제 파일을 여는 것과 같은 경로를 타도록 바이트로 내보냈다가 올린다.
 */
export function makeHwp(format: 'hwp' | 'hwpx' = 'hwp', name = `sample.${format}`): Upload {
  const Doc = core();
  const d = Doc.createEmpty();
  d.createBlankDocument();
  let p = 0;
  SAMPLE_LINES.forEach((line, i) => {
    d.insertText(0, p, 0, line);
    if (i < SAMPLE_LINES.length - 1) {
      d.splitParagraph(0, p, d.getParagraphLength(0, p));
      p++;
    }
  });
  d.applyCharFormat(0, 0, 0, 30, JSON.stringify({ fontSize: 1800, bold: true }));
  d.applyParaFormat(0, 0, JSON.stringify({ alignment: 'center' }));
  d.applyCharFormat(0, 3, 0, 30, JSON.stringify({ fontSize: 1300 }));
  const bytes = format === 'hwpx' ? d.exportHwpx() : d.exportHwp();
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) };
}

/** 쪽이 여러 장인 긴 한글 문서(200문단). 191번째 문단에만 오탈자("몇일")가 있다. */
export function makeLongHwp(name = 'long.hwp'): Upload {
  const Doc = core();
  const d = Doc.createEmpty();
  d.createBlankDocument();
  const total = 200;
  for (let i = 0; i < total; i++) {
    d.insertText(0, i, 0, i === 190 ? `${i + 1}번째 문단입니다. 몇일 뒤에 만나요.` : `${i + 1}번째 문단입니다. 특별한 내용이 없는 줄이에요. 이 줄은 조금 길게 써서 쪽이 넘어가도록 합니다.`);
    if (i < total - 1) d.splitParagraph(0, i, d.getParagraphLength(0, i));
  }
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(d.exportHwp()) };
}

export interface ParagraphRead {
  text: string;
  sizePt: number;
  bold: boolean;
}

/** 파일(바이트)을 열어 본문 문단의 글과 첫 글자 서식을 읽는다. */
export function readHwp(bytes: Buffer | Uint8Array): ParagraphRead[] {
  const Doc = core();
  const d = new Doc(new Uint8Array(bytes));
  const out: ParagraphRead[] = [];
  for (let s = 0; s < d.getSectionCount(); s++) {
    for (let p = 0; p < d.getParagraphCount(s); p++) {
      const len = d.getParagraphLength(s, p);
      if (len === 0) continue;
      const c = JSON.parse(d.getCharPropertiesAt(s, p, 0)) as { fontSize: number; bold: boolean };
      out.push({ text: d.getTextRange(s, p, 0, len), sizePt: c.fontSize / 100, bold: c.bold });
    }
  }
  return out;
}
