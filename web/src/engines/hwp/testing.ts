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

/** 시험용 문서에 만들 머리말·꼬리말 하나 */
export interface HeaderFooterSpec {
  /** 적용 쪽: 0 양쪽(기본), 1 짝수 쪽, 2 홀수 쪽 */
  applyTo?: 0 | 1 | 2;
  /** 문단마다 한 줄 */
  lines: string[];
  /** 글자 서식을 줄 범위(첫 문단 안의 글자 위치 [start, end)) */
  format?: Array<{ start: number; end: number; props: Record<string, unknown> }>;
}

/** 시험용 문서에 만들 각주·미주 하나 */
export interface NoteSpec {
  kind?: 'footnote' | 'endnote';
  /** 이것을 달 본문 문단 번호와, 그 문단 안 글자 위치 */
  para: number;
  at: number;
  /** 각주 안 문단마다 한 줄(번호 자리 뒤에 이어 쓴다) */
  lines: string[];
}

export interface AreaSampleSpec {
  /** 본문 줄들(줄마다 한 문단) */
  body: string[];
  headers?: HeaderFooterSpec[];
  footers?: HeaderFooterSpec[];
  notes?: NoteSpec[];
}

/**
 * 본문 줄에 머리말·꼬리말·각주·미주를 단 문서를 만들어 파일로 내보낸 뒤 다시 연다(실제 파일을 여는 것과 같은 경로).
 * 각주는 뒤쪽 것부터 달아서, 같은 문단에 여럿을 달아도 앞에서 단 각주의 컨트롤 번호가 밀리지 않게 한다.
 */
export function openAreaSample(
  spec: AreaSampleSpec,
  format: HwpFormat = 'hwp',
  tweak?: (doc: HwpDocument) => void,
  options: { reopen?: boolean } = {},
): { doc: HwpDocument; model: HwpModel } {
  const Doc = loadNodeCore();
  const built = Doc.createEmpty();
  built.createBlankDocument();
  spec.body.forEach((line, i) => {
    if (line) built.insertText(0, i, 0, line);
    if (i < spec.body.length - 1) built.splitParagraph(0, i, built.getParagraphLength(0, i));
  });

  const area = (isHeader: boolean, hf: HeaderFooterSpec): void => {
    const applyTo = hf.applyTo ?? 0;
    built.createHeaderFooter(0, isHeader, applyTo);
    hf.lines.forEach((line, q) => {
      if (line) built.insertTextInHeaderFooter(0, isHeader, applyTo, q, 0, line);
      if (q < hf.lines.length - 1) built.splitParagraphInHeaderFooter(0, isHeader, applyTo, q, [...line].length);
    });
    for (const f of hf.format ?? []) built.applyCharFormatInHeaderFooter(0, isHeader, applyTo, 0, f.start, 0, f.end, JSON.stringify(f.props));
  };
  (spec.headers ?? []).forEach((h) => area(true, h));
  (spec.footers ?? []).forEach((f) => area(false, f));

  const notes = [...(spec.notes ?? [])].sort((a, b) => b.para - a.para || b.at - a.at);
  for (const n of notes) {
    const made = JSON.parse(n.kind === 'endnote' ? built.insertEndnote(0, n.para, n.at) : built.insertFootnote(0, n.para, n.at)) as { paraIdx: number; controlIdx: number };
    // 첫 문단은 번호 자리(2글자) 뒤에 모든 줄을 이어 쓴 뒤, 줄 경계에서 뒤쪽부터 쪼갠다.
    // 코어의 각주 문단 쪼개기는 번호 자리 때문에 위치가 한 글자 앞으로 쏠려서 +1 로 맞춘다. 맞게 쪼개졌는지 아래에서 확인한다.
    built.insertTextInFootnote(0, made.paraIdx, made.controlIdx, 0, 2, n.lines.join(''));
    let boundary = 2 + [...n.lines.join('')].length;
    for (let q = n.lines.length - 1; q >= 1; q--) {
      boundary -= [...(n.lines[q] as string)].length;
      built.splitParagraphInFootnote(0, made.paraIdx, made.controlIdx, 0, boundary + 1);
    }
    const got = (JSON.parse(built.getFootnoteInfo(0, made.paraIdx, made.controlIdx)) as { texts: string[] }).texts.map((t, q) => (q === 0 ? t.slice(2) : t));
    if (JSON.stringify(got) !== JSON.stringify(n.lines)) throw new Error(`시험 문서의 각주를 줄 단위로 만들지 못했어요: ${JSON.stringify(got)}`);
  }

  tweak?.(built);
  // reopen: false 면 내보내지 않고 만든 문서를 그대로 쓴다(내보내기 때 사라지는 시험용 표시 문자를 시험할 때).
  if (options.reopen === false) return { doc: built, model: new HwpModel(built, format) };
  const bytes = format === 'hwpx' ? built.exportHwpx() : built.exportHwp();
  const doc = new Doc(new Uint8Array(bytes));
  return { doc, model: new HwpModel(doc, format) };
}
