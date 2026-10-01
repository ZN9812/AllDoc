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
  /** 언어 7칸(한글·영문·한자·일어·기타·기호·사용자)별 글꼴 이름 */
  fonts: string[];
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
      const c = JSON.parse(d.getCharPropertiesAt(s, p, 0)) as { fontSize: number; bold: boolean; fontFamilies?: string[] };
      out.push({ text: d.getTextRange(s, p, 0, len), sizePt: c.fontSize / 100, bold: c.bold, fonts: c.fontFamilies ?? [] });
    }
  }
  return out;
}

/** 표 칸 안의 글(표 안의 표 포함)을 문서 순서로, 빈 문단은 빼고 읽는다. 앱 코드와 따로 만든 읽기라서 결과를 독립적으로 확인할 수 있다. */
export function readHwpCells(bytes: Buffer | Uint8Array): string[] {
  const d = core2(bytes);
  const out: string[] = [];
  const asText = (sec: number, host: number, path: unknown[]): string => {
    const json = JSON.stringify(path);
    const len = d.getCellParagraphLengthByPath(sec, host, json);
    return len > 0 ? d.getTextInCellByPath(sec, host, json, 0, len) : '';
  };
  const visit = (sec: number, host: number, tablePath: Array<{ controlIndex: number; cellIndex: number; cellParaIndex: number }>, depth: number): void => {
    const last = tablePath[tablePath.length - 1]!;
    const base = tablePath.slice(0, -1);
    const dim = JSON.parse(depth === 1 ? d.getTableDimensions(sec, host, last.controlIndex) : d.getTableDimensionsByPath(sec, host, JSON.stringify(tablePath))) as { cellCount: number };
    for (let k = 0; k < dim.cellCount; k++) {
      const n = d.getCellParagraphCountByPath(sec, host, JSON.stringify([...base, { controlIndex: last.controlIndex, cellIndex: k, cellParaIndex: 0 }]));
      for (let q = 0; q < n; q++) {
        const path = [...base, { controlIndex: last.controlIndex, cellIndex: k, cellParaIndex: q }];
        const text = asText(sec, host, path);
        if (text.trim()) out.push(text);
        for (let j = 0; j < 16; j++) {
          const probe = [...path, { controlIndex: j, cellIndex: 0, cellParaIndex: 0 }];
          try {
            d.getTableDimensionsByPath(sec, host, JSON.stringify(probe));
          } catch (e) {
            if (/표가 아닙니다/.test(String((e as Error).message))) continue;
            break;
          }
          visit(sec, host, probe, depth + 1);
        }
      }
    }
  };
  for (let s = 0; s < d.getSectionCount(); s++) {
    for (let p = 0; p < d.getParagraphCount(s); p++) {
      const positions = JSON.parse(d.getControlTextPositions(s, p)) as unknown[];
      for (let c = 0; c < positions.length; c++) {
        try {
          d.getTableDimensions(s, p, c);
        } catch {
          continue;
        }
        visit(s, p, [{ controlIndex: c, cellIndex: 0, cellParaIndex: 0 }], 1);
      }
    }
  }
  return out;
}

function core2(bytes: Buffer | Uint8Array) {
  const Doc = core();
  return new Doc(new Uint8Array(bytes));
}

/** 표 칸 문단을 [행, 열]로 지정한 서식으로 시험할 때 쓰는 모양 */
export const TABLE_SAMPLE = {
  title: '휴가 신청서',
  closing: '감사합니다. 잘 되요.',
  cells: ['성명', '홍길동', '동행', '오랫만에 가요', '신청 사유', '몇일 동안 휴가를 할려고 합니다'],
  /** 오탈자를 모두 고친 뒤의 모습 */
  fixedClosing: '감사합니다. 잘 돼요.',
  fixedCells: ['성명', '홍길동', '동행', '오랜만에 가요', '신청 사유', '며칠 동안 휴가를 하려고 합니다'],
};

/**
 * 시험용 한글 문서(표 포함): 제목, 2x2 표(둘째 줄 오른쪽 칸에 오탈자), 첫 줄 오른쪽 칸 안의 작은 표(오탈자), 맺음 문단(오탈자).
 * sizes 가 true 면 표의 "성명" 칸만 16pt 굵게 해서 칸마다 서식이 다른 양식을 흉내 낸다.
 */
export function makeHwpWithTable(format: 'hwp' | 'hwpx' = 'hwp', name = `form.${format}`, opts: { sizes?: boolean } = {}): Upload {
  const Doc = core();
  const d = Doc.createEmpty();
  d.createBlankDocument();
  d.insertText(0, 0, 0, TABLE_SAMPLE.title);
  d.splitParagraph(0, 0, d.getParagraphLength(0, 0));
  const t = JSON.parse(d.createTable(0, 1, 0, 2, 2)) as { paraIdx: number; controlIdx: number };
  const outer = ['성명', '홍길동', '신청 사유', '몇일 동안 휴가를 할려고 합니다'];
  outer.forEach((text, k) => d.insertTextInCell(0, t.paraIdx, t.controlIdx, k, 0, 0, text));
  d.insertText(0, t.paraIdx + 1, 0, TABLE_SAMPLE.closing);

  // 안쪽 표: 본문 끝에 임시 표를 만들어 복사한 뒤 "홍길동" 칸에 붙이고 임시 표는 지운다.
  const tail = d.getParagraphCount(0) - 1;
  d.splitParagraph(0, tail, d.getParagraphLength(0, tail));
  const tmp = JSON.parse(d.createTable(0, tail + 1, 0, 1, 2)) as { paraIdx: number; controlIdx: number };
  d.insertTextInCell(0, tmp.paraIdx, tmp.controlIdx, 0, 0, 0, '동행');
  d.insertTextInCell(0, tmp.paraIdx, tmp.controlIdx, 1, 0, 0, '오랫만에 가요');
  d.copyControl(0, tmp.paraIdx, '', tmp.controlIdx);
  d.pasteInternalInCell(0, t.paraIdx, t.controlIdx, 1, 0, 0);
  d.deleteTableControl(0, tmp.paraIdx, tmp.controlIdx);

  if (opts.sizes) d.applyCharFormatInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, 2, JSON.stringify({ fontSize: 1600, bold: true }));
  const bytes = format === 'hwpx' ? d.exportHwpx() : d.exportHwp();
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) };
}

/**
 * 가장 바깥 표 하나에 문단이 260개 든 한글 문서(한글 편집기가 칸으로 이동하면 화면이 오래 멈추는 크기라서 앱이 칸 이동을 하지 않는다).
 * 오탈자("몇일")는 150번째 줄에만 있다(한 제안의 변경이 60개를 넘으면 서버가 버린다).
 */
export function makeHwpWithBigTable(rows = 260): Upload {
  const Doc = core();
  const d = Doc.createEmpty();
  d.createBlankDocument();
  d.insertText(0, 0, 0, '큰 표');
  d.splitParagraph(0, 0, d.getParagraphLength(0, 0));
  const t = JSON.parse(d.createTable(0, 1, 0, rows, 1)) as { paraIdx: number; controlIdx: number };
  for (let r = 0; r < rows; r++) d.insertTextInCell(0, t.paraIdx, t.controlIdx, r, 0, 0, r === 149 ? '150번째 줄 몇일 뒤' : `${r + 1}번째 줄`);
  return { name: 'big-table.hwp', mimeType: 'application/octet-stream', buffer: Buffer.from(d.exportHwp()) };
}
