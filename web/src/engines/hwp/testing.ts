// 시험 전용: Node 에서 진짜 @rhwp/core(WASM)를 불러오고, 시험용 문서를 만든다. 화면 코드에서는 쓰지 않는다.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HwpDocument, initSync } from '@rhwp/core';
import { HwpModel, type HwpFormat } from './model';

let ready = false;

export function loadNodeCore(): typeof HwpDocument {
  if (!ready) {
    // 코어는 글자 폭 계산을 브라우저에 맡긴다. Node 에는 canvas 가 없으므로 글자 수에 비례하는 근사값을 쓴다.
    (globalThis as { measureTextWidth?: (font: string, text: string) => number }).measureTextWidth = (font, text) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
      let w = 0;
      for (const ch of text) w += ch.charCodeAt(0) > 0x2000 ? size : size / 2;
      return w;
    };
    const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm');
    initSync({ module: readFileSync(wasm) });
    ready = true;
  }
  return HwpDocument;
}

/** 줄마다 한 문단인 문서를 만들어 파일(바이트)로 내보낸 뒤 다시 연다(실제 파일을 여는 것과 같은 경로). */
export function openSample(lines: string[], format: HwpFormat = 'hwp', tweak?: (doc: HwpDocument) => void): { doc: HwpDocument; model: HwpModel } {
  const Doc = loadNodeCore();
  const built = Doc.createEmpty();
  built.createBlankDocument();
  let p = 0;
  lines.forEach((line, i) => {
    if (line) built.insertText(0, p, 0, line);
    if (i < lines.length - 1) {
      built.splitParagraph(0, p, built.getParagraphLength(0, p));
      p++;
    }
  });
  tweak?.(built);
  const bytes = format === 'hwpx' ? built.exportHwpx() : built.exportHwp();
  const doc = new Doc(new Uint8Array(bytes));
  return { doc, model: new HwpModel(doc, format) };
}

export interface TableSampleSpec {
  /** 표 앞 본문 줄들(줄마다 한 문단) */
  before?: string[];
  /** 행마다 칸의 글(빈 문자열은 빈 칸) */
  cells: string[][];
  /** 바깥 표의 [행, 열](0부터) 칸 안에 넣을 표(표 안의 표) */
  nested?: { at: [number, number]; cells: string[][] };
  /** 표 뒤 본문 줄들 */
  after?: string[];
}

/** 칸 글을 채운 표를 본문 문단에 놓는다. 표가 놓인 문단 번호와 컨트롤 번호를 돌려준다. */
function putTable(d: HwpDocument, para: number, cells: string[][]): { paraIdx: number; controlIdx: number } {
  const cols = Math.max(...cells.map((r) => r.length));
  const t = JSON.parse(d.createTable(0, para, 0, cells.length, cols)) as { paraIdx: number; controlIdx: number };
  cells.forEach((row, r) =>
    row.forEach((text, c) => {
      if (text) d.insertTextInCell(0, t.paraIdx, t.controlIdx, r * cols + c, 0, 0, text);
    }),
  );
  return t;
}

/**
 * 본문 줄 사이에 표를 하나 끼운 문서를 만들어 파일로 내보낸 뒤 다시 연다(실제 파일을 여는 것과 같은 경로).
 * 표 안의 표는 코어에 직접 만드는 함수가 없어서, 본문 끝에 임시 표를 만들어 복사한 뒤 칸에 붙이고 임시 표는 지운다.
 * host 는 바깥 표가 놓인 본문 문단 번호다(코어의 표 함수를 직접 부를 때 쓴다).
 */
export function openTableSample(spec: TableSampleSpec, format: HwpFormat = 'hwp', tweak?: (doc: HwpDocument) => void): { doc: HwpDocument; model: HwpModel; host: number } {
  const Doc = loadNodeCore();
  const built = Doc.createEmpty();
  built.createBlankDocument();

  let p = 0;
  for (const line of spec.before ?? []) {
    if (line) built.insertText(0, p, 0, line);
    built.splitParagraph(0, p, built.getParagraphLength(0, p));
    p++;
  }
  const outer = putTable(built, p, spec.cells);

  // 표 뒤 문단: 코어가 표 다음에 빈 문단을 하나 두므로 거기에 이어 쓴다.
  const after = spec.after ?? [];
  let q = outer.paraIdx + 1;
  after.forEach((line, i) => {
    if (line) built.insertText(0, q, 0, line);
    if (i < after.length - 1) {
      built.splitParagraph(0, q, built.getParagraphLength(0, q));
      q++;
    }
  });

  if (spec.nested) {
    const [row, col] = spec.nested.at;
    const cols = Math.max(...spec.cells.map((r) => r.length));
    // 임시 표를 놓을 문단을 맨 끝에 하나 더 만든다.
    const tail = built.getParagraphCount(0) - 1;
    built.splitParagraph(0, tail, built.getParagraphLength(0, tail));
    const temp = putTable(built, tail + 1, spec.nested.cells);
    built.copyControl(0, temp.paraIdx, '', temp.controlIdx);
    built.pasteInternalInCell(0, outer.paraIdx, outer.controlIdx, row * cols + col, 0, 0);
    built.deleteTableControl(0, temp.paraIdx, temp.controlIdx);
  }

  tweak?.(built);
  const bytes = format === 'hwpx' ? built.exportHwpx() : built.exportHwp();
  const doc = new Doc(new Uint8Array(bytes));
  return { doc, model: new HwpModel(doc, format), host: outer.paraIdx };
}
