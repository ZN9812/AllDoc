// 한글 문서 시험 파일을 @rhwp/core(WASM)로 직접 만들고, 내려받은 파일을 다시 읽어 확인한다.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HwpDocument, initSync } from '@rhwp/core';
import { HwpModel } from '../web/src/engines/hwp/model';
import { buildBoxSample } from '../web/src/engines/hwp/testing';
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
            if (/표가 아닙니다/.test(e instanceof Error ? e.message : String(e))) continue; // 코어는 문자열을 던진다
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

/**
 * 시험용 한글 문서(머리말·꼬리말·각주 포함): 본문 두 줄, 머리말, 꼬리말, 둘째 줄에 단 각주.
 * 오탈자가 머리말("오랫만"), 본문("몇일"), 각주("되요"), 꼬리말("할려고")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.
 */
export const AREA_SAMPLE = {
  body: ['휴가 신청서', '몇일 동안 쉬겠습니다.'],
  header: '머리말 오랫만 입니다',
  footer: '꼬리말 할려고 합니다',
  note: '각주 되요 입니다',
  /** 오탈자를 모두 고친 뒤의 모습 */
  fixed: { body: ['휴가 신청서', '며칠 동안 쉬겠습니다.'], header: '머리말 오랜만 입니다', footer: '꼬리말 하려고 합니다', note: '각주 돼요 입니다' },
};

/**
 * headerSize 가 있으면 머리말 글자 크기(pt)를 그것으로 해서, 본문과 서식이 다른 머리말을 흉내 낸다.
 * extraBody 가 있으면 본문 끝에 그만큼 보통 문단을 더한다(서식 점검이 본문 문단 수를 보고 판단하기 때문).
 */
export function makeHwpWithAreas(format: 'hwp' | 'hwpx' = 'hwp', name = `areas.${format}`, opts: { headerSize?: number; extraBody?: number } = {}): Upload {
  const Doc = core();
  const d = Doc.createEmpty();
  d.createBlankDocument();
  const lines = [...AREA_SAMPLE.body, ...Array.from({ length: opts.extraBody ?? 0 }, (_, i) => `본문 ${i + 1}번째 문장입니다.`)];
  lines.forEach((line, i) => {
    d.insertText(0, i, 0, line);
    if (i < lines.length - 1) d.splitParagraph(0, i, d.getParagraphLength(0, i));
  });
  d.createHeaderFooter(0, true, 0);
  d.insertTextInHeaderFooter(0, true, 0, 0, 0, AREA_SAMPLE.header);
  if (opts.headerSize) d.applyCharFormatInHeaderFooter(0, true, 0, 0, 0, 0, [...AREA_SAMPLE.header].length, JSON.stringify({ fontSize: opts.headerSize * 100, bold: true }));
  d.createHeaderFooter(0, false, 0);
  d.insertTextInHeaderFooter(0, false, 0, 0, 0, AREA_SAMPLE.footer);
  const note = JSON.parse(d.insertFootnote(0, 1, 2)) as { paraIdx: number; controlIdx: number };
  d.insertTextInFootnote(0, note.paraIdx, note.controlIdx, 0, 2, AREA_SAMPLE.note);
  const bytes = format === 'hwpx' ? d.exportHwpx() : d.exportHwp();
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) };
}

export interface AreaRead {
  headers: string[];
  /** 머리말 문단마다 첫 글자의 글자 크기(pt) */
  headerSizes: number[];
  footers: string[];
  /** 각주·미주 글(맨 앞 번호 자리는 뺀다) */
  notes: string[];
}

/** 파일(바이트)을 열어 머리말·꼬리말·각주의 글을 읽는다. 앱 코드와 따로 만든 읽기라서 결과를 독립적으로 확인할 수 있다. */
export function readHwpAreas(bytes: Buffer | Uint8Array): AreaRead {
  const Doc = core();
  const d = new Doc(new Uint8Array(bytes));
  const out: AreaRead = { headers: [], headerSizes: [], footers: [], notes: [] };
  const list = (JSON.parse(d.getHeaderFooterList(0, true, 0)) as { items?: Array<{ sectionIdx: number; isHeader: boolean; applyTo: number }> }).items ?? [];
  for (const it of list) {
    const info = JSON.parse(d.getHeaderFooter(it.sectionIdx, it.isHeader, it.applyTo)) as { paraCount?: number };
    for (let q = 0; q < (info.paraCount ?? 0); q++) {
      const para = JSON.parse(d.getHeaderFooterParaInfo(it.sectionIdx, it.isHeader, it.applyTo, q)) as { text?: string };
      if (!para.text) continue;
      (it.isHeader ? out.headers : out.footers).push(para.text);
      if (it.isHeader) out.headerSizes.push((JSON.parse(d.getCharPropertiesInHeaderFooter(it.sectionIdx, true, it.applyTo, q, 0)) as { fontSize: number }).fontSize / 100);
    }
  }
  // 각주·미주: 컨트롤 목록의 문단 번호는 구역을 이어 붙인 번호다(시험 문서는 구역이 하나다).
  for (const c of JSON.parse(d.getControls()) as Array<{ ctrlId: string; list: number; para: number; controlIndex: number }>) {
    if ((c.ctrlId !== 'fn' && c.ctrlId !== 'en') || c.list !== 0) continue;
    const info = JSON.parse(d.getFootnoteInfo(0, c.para, c.controlIndex)) as { texts?: string[] };
    for (const [q, t] of (info.texts ?? []).entries()) if (t.trim()) out.notes.push(q === 0 ? t.slice(1).trim() : t);
  }
  return out;
}

/**
 * 시험용 한글 글상자 문서. 본문 첫 문단에 글상자 1(문단 둘), 둘째 문단에 표(2칸)를 놓고 그 오른쪽 칸 안에 글상자 2 를 둔다(표 칸 안의 글상자).
 * 오탈자가 글상자 1 의 첫 문단("오랫만")·둘째 문단("할려고"), 글상자 2("되요"), 본문("몇일")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.
 */
export const BOX_SAMPLE = {
  body: ['휴가 신청서', '몇일 동안 쉬겠습니다.'],
  box1: ['신청 기간은 오랫만 입니다', '담당자가 할려고 합니다'],
  cells: ['구분', '내용'],
  box2: '비고: 되요 라고 적습니다',
  /** 오탈자를 모두 고친 뒤의 모습 */
  fixed: { body: '며칠 동안 쉬겠습니다.', box1: ['신청 기간은 오랜만 입니다', '담당자가 하려고 합니다'], box2: '비고: 돼요 라고 적습니다' },
};

/**
 * boxSize 가 있으면 글상자 안의 글을 그 크기(pt)의 굵은 글씨로 해서 본문과 서식이 다른 글상자를 흉내 낸다(표 칸 안의 글상자도 같다).
 * extraBody 가 있으면 본문 끝에 그만큼 보통 문단을 더한다(서식 점검이 본문 문단 수를 보고 판단하기 때문).
 */
export async function makeHwpWithBoxes(format: 'hwp' | 'hwpx' = 'hwp', name = `boxes.${format}`, opts: { boxSize?: number; extraBody?: number } = {}): Promise<Upload> {
  const body = [BOX_SAMPLE.body[0] as string, BOX_SAMPLE.body[1] as string, ...Array.from({ length: opts.extraBody ?? 0 }, (_, i) => `본문 ${i + 1}번째 문장입니다.`)];
  let { bytes } = buildBoxSample({ body, boxes: [{ para: 0, lines: BOX_SAMPLE.box1 }], cellBox: { para: 1, cells: [BOX_SAMPLE.cells], at: [0, 1], lines: [BOX_SAMPLE.box2] } }, format);
  if (opts.boxSize) {
    // 모델로 글상자 안 문단의 글자 크기를 정한다(표 칸 안의 글상자까지 한꺼번에).
    const model = new HwpModel(core2(bytes), format);
    const boxParas = model.summarize().paragraphs.filter((p) => p.area?.kind === 'textbox');
    const r = await model.apply(boxParas.map((p) => ({ type: 'setCharStyle' as const, paragraph: p.index, style: { fontSizePt: opts.boxSize as number, bold: true } })));
    if (!r.ok) throw new Error(`시험 문서의 글상자 서식을 정하지 못했어요: ${JSON.stringify(r)}`);
    bytes = model.exportBytes().bytes;
  }
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) };
}

export interface BoxParaRead {
  text: string;
  /** 문단 첫 글자의 글자 크기(pt) */
  sizePt: number;
  bold: boolean;
}

/**
 * 파일(바이트)을 열어 글상자 안의 글(표 칸 안·글상자 안의 글상자와 글상자 안 표의 칸 포함)을 문서 순서로, 빈 문단은 빼고 읽는다.
 * 앱 코드와 따로 만든 읽기라서 결과를 독립적으로 확인할 수 있다(그림의 글 캡션은 글상자가 아니라서 개체의 갈래를 복사 함수로 확인해 뺀다).
 */
export function readHwpBoxes(bytes: Buffer | Uint8Array): BoxParaRead[] {
  const d = core2(bytes);
  const out: BoxParaRead[] = [];
  type Step = { controlIndex: number; cellIndex: number; cellParaIndex: number };
  const json = (path: Step[]): string => JSON.stringify(path);

  // 문단(경로 para, 본문 문단이면 빈 목록)에 든 컨트롤 j 를 따라간다. inBox 는 그 문단이 글상자 안인가.
  const follow = (sec: number, host: number, para: Step[], j: number, inBox: boolean): void => {
    const probe: Step[] = [...para, { controlIndex: j, cellIndex: 0, cellParaIndex: 0 }];
    let dim: { cellCount: number } | null = null;
    try {
      dim = JSON.parse(para.length === 0 ? d.getTableDimensions(sec, host, j) : d.getTableDimensionsByPath(sec, host, json(probe))) as { cellCount: number };
    } catch {
      dim = null; // 표가 아니다
    }
    if (dim) {
      for (let k = 0; k < dim.cellCount; k++) {
        const n = d.getCellParagraphCountByPath(sec, host, json([...para, { controlIndex: j, cellIndex: k, cellParaIndex: 0 }]));
        for (let q = 0; q < n; q++) walk(sec, host, [...para, { controlIndex: j, cellIndex: k, cellParaIndex: q }], inBox);
      }
      return;
    }
    let n: number;
    try {
      n = d.getCellParagraphCountByPath(sec, host, json(probe));
    } catch {
      return; // 글상자도 표도 아닌 컨트롤
    }
    const label = (JSON.parse(d.copyControl(sec, host, para.length === 0 ? '' : json(para), j)) as { text?: string }).text;
    if (label !== '[도형]') return; // 그림의 글 캡션 따위
    for (let q = 0; q < n; q++) walk(sec, host, [...para, { controlIndex: j, cellIndex: 0, cellParaIndex: q }], true);
  };

  // 문단(경로 path)의 글을 담고(글상자 안이면), 그 안의 컨트롤들을 따라간다.
  const walk = (sec: number, host: number, path: Step[], inBox: boolean): void => {
    if (inBox) {
      const len = d.getCellParagraphLengthByPath(sec, host, json(path));
      if (len > 0) {
        const text = d.getTextInCellByPath(sec, host, json(path), 0, len);
        const c = JSON.parse(d.getCellCharPropertiesAtByPath(sec, host, json(path), 0)) as { fontSize: number; bold: boolean };
        if (text.trim()) out.push({ text, sizePt: c.fontSize / 100, bold: c.bold });
      }
    }
    for (let j = 0; j < 16; j++) {
      try {
        d.getTableDimensionsByPath(sec, host, json([...path, { controlIndex: j, cellIndex: 0, cellParaIndex: 0 }]));
      } catch (e) {
        // 코어가 던지는 값은 Error 가 아니라 문자열일 수 있다.
        if (!/표가 아닙니다/.test(e instanceof Error ? e.message : String(e))) break; // 컨트롤이 더 없다
      }
      follow(sec, host, path, j, inBox);
    }
  };

  for (let s = 0; s < d.getSectionCount(); s++) {
    for (let p = 0; p < d.getParagraphCount(s); p++) {
      const positions = JSON.parse(d.getControlTextPositions(s, p)) as unknown[];
      for (let c = 0; c < positions.length; c++) follow(s, p, [], c, false);
    }
  }
  return out;
}

/**
 * 글상자가 여러 모양으로 놓인 시험용 한글 문서: 본문 첫 문단의 글상자 1(그 첫 문단에 안쪽 글상자 2 와 안쪽 표가 들어 있다)과,
 * 둘째 문단의 표(2칸) 오른쪽 칸 안의 글상자 3. 오탈자가 글상자 1("몇일")·안쪽 글상자 2("할려고")·글상자 1 안 표의 칸("오랫만")·표 칸 안 글상자 3("되요")에 하나씩 있다.
 */
export const NEST_SAMPLE = {
  body: ['휴가 신청서', '표가 놓일 문단입니다'],
  outer: '바깥 글상자 몇일 입니다',
  inner: '안쪽 글상자 할려고 합니다',
  boxTable: '글상자 안 표 오랫만 입니다',
  cells: ['구분', '내용'],
  cellBox: '표 칸 안 글상자 되요 라고 적습니다',
};

export function makeHwpWithNestedBoxes(format: 'hwp' | 'hwpx' = 'hwp', name = `nested-boxes.${format}`): Upload {
  const { bytes } = buildBoxSample(
    {
      body: NEST_SAMPLE.body,
      boxes: [{ para: 0, lines: [NEST_SAMPLE.outer] }],
      cellBox: { para: 1, cells: [NEST_SAMPLE.cells], at: [0, 1], lines: [NEST_SAMPLE.cellBox] },
      innerBox: { outer: 0, lines: [NEST_SAMPLE.inner] },
      innerTable: { outer: 0, cells: [[NEST_SAMPLE.boxTable]] },
    },
    format,
  );
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) };
}
