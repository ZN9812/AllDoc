// 한글(HWP·HWPX) 문서의 읽기와 변경. @rhwp/core(WASM)의 문서 객체를 감싸서 화면과 무관하게 동작한다.
//
// 문단 번호: 문서 순서로 센 "문단 칸"의 번호(0부터). 본문 문단 다음에, 그 문단에 놓인 표의 칸 안 문단(표 안의 표 포함)이 이어진다.
//   표가 없는 문서에서는 본문 문단 번호(구역을 이어 붙인 번호)와 같다.
//   머리말·꼬리말, 각주, 글상자 안의 글은 다루지 않는다.
// 글자 위치: 코어는 유니코드 "글자"(코드 포인트) 단위로 센다. 자바스크립트 문자열 위치(UTF-16)와 다를 수 있어 바꿔서 쓴다.
import {
  textGuard,
  type Align,
  type CellPlace,
  type CharStyle,
  type DocSummary,
  type Op,
  type ParagraphInfo,
  type ParaStyle,
} from '@alldoc/shared';
import { applyAtomic, stale, unsupported, type OneResult } from '../applyOps';
import type { ApplyFailure, ApplyResult } from '../types';

/** 코어 문서 객체 중 이 모듈이 쓰는 부분만 좁혀 둔 약속(시험에서는 진짜 코어를, 화면에서는 브라우저의 코어를 끼운다). */
export interface HwpDocLike {
  getSectionCount(): number;
  getParagraphCount(section: number): number;
  getParagraphLength(section: number, para: number): number;
  getTextRange(section: number, para: number, offset: number, count: number): string;
  getCharPropertiesAt(section: number, para: number, offset: number): string;
  getParaPropertiesAt(section: number, para: number): string;
  insertText(section: number, para: number, offset: number, text: string): string;
  replaceText(section: number, para: number, offset: number, length: number, text: string): string;
  applyCharFormat(section: number, para: number, start: number, end: number, propsJson: string): string;
  applyParaFormat(section: number, para: number, propsJson: string): string;
  findOrCreateFontId(name: string): number;
  findOrCreateFontIdForLang(lang: number, name: string): number;
  pageCount(): number;
  exportHwpWithReport(): ExportReportLike;
  exportHwpxWithReport(): ExportReportLike;

  // 표: 본문 문단에 놓인 표는 (구역, 문단, 컨트롤 번호)로, 표 안의 표까지는 경로(JSON)로 가리킨다.
  // 경로는 `[{"controlIndex","cellIndex","cellParaIndex"}, …]` 이고 마지막 단계의 cellParaIndex 가 가리키는 문단이 대상이다.
  getControlTextPositions(section: number, para: number): string;
  getTableDimensions(section: number, parentPara: number, control: number): string;
  getTableDimensionsByPath(section: number, parentPara: number, pathJson: string): string;
  getCellInfo(section: number, parentPara: number, control: number, cell: number): string;
  getCellInfoByPath(section: number, parentPara: number, pathJson: string): string;
  getCellParagraphCountByPath(section: number, parentPara: number, pathJson: string): number;
  getCellParagraphLengthByPath(section: number, parentPara: number, pathJson: string): number;
  getTextInCellByPath(section: number, parentPara: number, pathJson: string, offset: number, count: number): string;
  getCellCharPropertiesAtByPath(section: number, parentPara: number, pathJson: string, offset: number): string;
  insertTextInCellByPath(section: number, parentPara: number, pathJson: string, offset: number, text: string): string;
  deleteTextInCellByPath(section: number, parentPara: number, pathJson: string, offset: number, count: number): string;
  applyCharFormatInCellByPath(section: number, parentPara: number, pathJson: string, start: number, end: number, propsJson: string): string;
  setCharShapeIdInCellByPath(section: number, parentPara: number, pathJson: string, start: number, end: number, charShapeId: number): string;
  // 문단 서식은 코어가 경로 기반 함수를 주지 않아서, 본문에 놓인 표(깊이 1)의 칸만 읽고 바꿀 수 있다.
  getCellParaPropertiesAt(section: number, parentPara: number, control: number, cell: number, cellPara: number): string;
  applyParaFormatInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, propsJson: string): string;

  /** 문서 안 모든 컨트롤의 목록. 표 안의 표가 있는지 미리 알아 불필요한 탐색을 줄이는 데 쓴다(없으면 항상 탐색한다). */
  getControls?(): string;
  /** 묶음 모드: 그 사이의 변경은 쪽 나누기 계산을 건너뛰고, 끝낼 때 한 번만 한다(큰 문서에서 수백 배 빠르다). */
  beginBatch?(): string;
  endBatch?(): string;
}

export interface ExportReportLike {
  contentLoss(): string;
  takeBytes(): Uint8Array;
  free(): void;
}

export type HwpFormat = 'hwp' | 'hwpx';

/** 표 안으로 한 단계 들어가는 길: 문단 안의 컨트롤(표) 번호, 그 표의 칸 번호, 칸 안의 문단 번호 */
export interface CellStep {
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

interface BodySlot {
  kind: 'body';
  sec: number;
  para: number;
}

interface CellSlot {
  kind: 'cell';
  sec: number;
  /** 가장 바깥 표가 놓인 본문 문단(구역 안 번호) */
  host: number;
  path: CellStep[];
  /** path 를 JSON 으로 만든 것(코어에 넘기는 값이라 한 번만 만든다) */
  pathJson: string;
  place: CellPlace;
  /** 이 칸이 든 가장 바깥 표 하나에 있는 문단의 수(안쪽 표 포함) */
  tableWeight: number;
}

type Slot = BodySlot | CellSlot;

/** 편집기가 표 칸으로 이동할 때 받는 위치(편집기의 DocumentPosition 과 같은 모양) */
export interface CellFocus {
  position: {
    sectionIndex: number;
    paragraphIndex: number;
    charOffset: number;
    parentParaIndex: number;
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
    cellPath?: CellStep[];
  };
  /** 선택할 글의 끝(없으면 캐럿만 놓는다) */
  end?: number;
  /** 가장 바깥 표가 너무 커서(MAX_FOCUS_TABLE_PARAGRAPHS) 칸으로 이동하면 화면이 오래 멈춘다. 이동하지 않는다. */
  tooBig?: boolean;
}

const ALIGNS: readonly string[] = ['left', 'center', 'right', 'justify'];

/** 탐색 안전장치: 이보다 깊거나 많은 표·문단은 따라가지 않는다(깨진 파일에서 끝없이 도는 것을 막는다). */
const MAX_TABLE_DEPTH = 8;
const MAX_SLOTS = 200_000;
/** 한 문단 안의 컨트롤을 이 수까지만 살핀다. */
const MAX_CONTROLS_PER_PARAGRAPH = 64;
/**
 * 편집기를 표 칸으로 이동시키는 데 걸리는 시간은 가장 바깥 표의 크기에 따라 크게 달라진다. 실제 문서 11개(표 하나당 문단 70개 이하)에서는
 * 글을 선택해도 3~22ms 였지만, 한 표에 문단이 1,588개 든 문서에서는 선택하면 칸 크기와 상관없이 약 13초, 캐럿만 옮겨도 칸에 따라 최대 8초가 걸렸다
 * (그동안 편집기와 우리 앱 화면이 모두 멈춘다). 그래서 가장 바깥 표의 문단이 이 수를 넘으면 칸으로 이동하지 않는다(그 표가 있는 곳으로 안내한다).
 */
export const MAX_FOCUS_TABLE_PARAGRAPHS = 250;
/** 코어가 "그 컨트롤은 표가 아니다"라고 알리는 오류 문구(표가 아닌 컨트롤 뒤에 표가 있을 수 있어 계속 살핀다). 다른 오류는 거기서 멈춘다. */
const NOT_A_TABLE = /표가 아닙니다|not a table/i;

/** 코어의 "글자" 수(코드 포인트) */
export const codePointLength = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

const toAlign = (raw: unknown): Align | undefined => (typeof raw === 'string' && ALIGNS.includes(raw) ? (raw as Align) : undefined);

interface CoreChar {
  fontFamily?: string;
  fontFamilies?: string[];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 글자 모양 번호. 글을 바꾼 뒤 원래 글자 모양을 그대로 되돌려 입히는 데 쓴다. */
  charShapeId?: number;
}

interface CorePara {
  alignment?: string;
  lineSpacing?: number;
  lineSpacingType?: string;
}

const failed = (message: string): ApplyFailure => ({ ok: false, reason: 'failed', message });
const ok = (raw: string): boolean => {
  try {
    return (JSON.parse(raw) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
};

export interface ExportedBytes {
  bytes: Uint8Array;
  /** 내보낼 때 보존되지 않는 요소의 수(0 이면 손실 없음) */
  lossCount: number;
}

export class HwpModel {
  private slots: Slot[] | null = null;

  constructor(
    private readonly doc: HwpDocLike,
    readonly format: HwpFormat,
  ) {}

  // ───────────────────────── 문단 칸 열거 ─────────────────────────

  /** 문서 순서의 문단 칸 목록(처음 필요할 때 한 번 만든다. 글 바꾸기·서식 변경은 문단 수를 바꾸지 않으므로 그대로 쓴다). */
  private slotList(): Slot[] {
    this.slots ??= this.buildSlots();
    return this.slots;
  }

  private mayHaveNestedTables(): boolean {
    if (!this.doc.getControls) return true;
    try {
      const list = JSON.parse(this.doc.getControls()) as Array<{ ctrlId?: string; list?: number }>;
      return list.some((c) => c.ctrlId === 'tbl' && c.list !== 0);
    } catch {
      return true;
    }
  }

  private buildSlots(): Slot[] {
    const doc = this.doc;
    const out: Slot[] = [];
    const probeNested = this.mayHaveNestedTables();
    let tables = 0;

    const parse = <T>(raw: string): T => JSON.parse(raw) as T;

    /** tablePath 의 마지막 단계(controlIndex)가 가리키는 표의 모든 칸 안 문단을 담는다. depth 1 은 본문에 놓인 표. */
    const visitTable = (sec: number, host: number, tablePath: CellStep[], depth: number): void => {
      if (depth > MAX_TABLE_DEPTH || out.length >= MAX_SLOTS) return;
      const last = tablePath[tablePath.length - 1] as CellStep;
      const base = tablePath.slice(0, -1);
      const number = ++tables;
      try {
        const dim = parse<{ cellCount: number }>(depth === 1 ? doc.getTableDimensions(sec, host, last.controlIndex) : doc.getTableDimensionsByPath(sec, host, JSON.stringify(tablePath)));
        for (let k = 0; k < dim.cellCount; k++) {
          const cellRef = [...base, { controlIndex: last.controlIndex, cellIndex: k, cellParaIndex: 0 }];
          const info = parse<{ row: number; col: number }>(
            depth === 1 ? doc.getCellInfo(sec, host, last.controlIndex, k) : doc.getCellInfoByPath(sec, host, JSON.stringify(cellRef)),
          );
          const count = doc.getCellParagraphCountByPath(sec, host, JSON.stringify(cellRef));
          for (let q = 0; q < count; q++) {
            if (out.length >= MAX_SLOTS) return;
            const path = [...base, { controlIndex: last.controlIndex, cellIndex: k, cellParaIndex: q }];
            out.push({ kind: 'cell', sec, host, path, pathJson: JSON.stringify(path), place: { table: number, row: info.row + 1, col: info.col + 1, depth }, tableWeight: 0 });
            if (probeNested) visitNested(sec, host, path, depth);
          }
        }
      } catch {
        // 읽을 수 없는 표는 건너뛴다(다른 표와 본문은 그대로 다룬다).
      }
    };

    /** 칸 안 문단에 들어 있는 표(표 안의 표)를 찾아 따라간다. */
    const visitNested = (sec: number, host: number, paragraphPath: CellStep[], depth: number): void => {
      for (let j = 0; j < MAX_CONTROLS_PER_PARAGRAPH; j++) {
        const probe = [...paragraphPath, { controlIndex: j, cellIndex: 0, cellParaIndex: 0 }];
        try {
          doc.getTableDimensionsByPath(sec, host, JSON.stringify(probe));
        } catch (e) {
          if (NOT_A_TABLE.test(e instanceof Error ? e.message : String(e))) continue;
          return; // 더 이상 컨트롤이 없다("범위 초과") 또는 알 수 없는 오류
        }
        visitTable(sec, host, probe, depth + 1);
      }
    };

    for (let s = 0; s < doc.getSectionCount(); s++) {
      const count = doc.getParagraphCount(s);
      for (let p = 0; p < count; p++) {
        if (out.length >= MAX_SLOTS) return out;
        out.push({ kind: 'body', sec: s, para: p });
        let positions: unknown;
        try {
          positions = parse<unknown>(doc.getControlTextPositions(s, p));
        } catch {
          continue;
        }
        if (!Array.isArray(positions)) continue;
        for (let c = 0; c < positions.length; c++) {
          try {
            doc.getTableDimensions(s, p, c);
          } catch {
            continue; // 표가 아닌 컨트롤(구역 설정, 그림 등)
          }
          const first = out.length;
          visitTable(s, p, [{ controlIndex: c, cellIndex: 0, cellParaIndex: 0 }], 1);
          // 이 표(안쪽 표 포함)가 담은 칸 문단은 모두 방금 더해진 것들이다.
          for (let k = first; k < out.length; k++) (out[k] as CellSlot).tableWeight = out.length - first;
        }
      }
    }
    return out;
  }

  /** 문서 구조의 크기(시험·진단용): 본문 문단 수, 표 칸 안 문단 수, 표 수(표 안의 표 포함) */
  describeStructure(): { bodyParagraphs: number; cellParagraphs: number; tables: number } {
    const list = this.slotList();
    const cells = list.filter((s): s is CellSlot => s.kind === 'cell');
    return {
      bodyParagraphs: list.length - cells.length,
      cellParagraphs: cells.length,
      tables: cells.reduce((max, c) => Math.max(max, c.place.table), 0),
    };
  }

  private locate(index: number): Slot | null {
    const list = this.slotList();
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
    return list[index] ?? null;
  }

  /**
   * 편집기에서 이 문단으로 이동하는 데 쓰는 위치(구역, 구역 안 문단 번호, 글자 수).
   * 편집기는 표 칸으로 바로 이동하는 방법을 주지 않아서, 표 안의 문단은 그 표가 놓인 본문 문단으로 안내한다(inTable).
   */
  paragraphTarget(index: number): { section: number; paragraph: number; length: number; inTable: boolean } | null {
    const slot = this.locate(index);
    if (!slot) return null;
    const para = slot.kind === 'body' ? slot.para : slot.host;
    return { section: slot.sec, paragraph: para, length: this.doc.getParagraphLength(slot.sec, para), inTable: slot.kind === 'cell' };
  }

  /**
   * 편집기를 이 문단(표 칸 안)으로 이동시키는 데 쓰는 위치. 본문 문단이면 null.
   * find 가 이 문단에 들어 있으면 그 글을 선택하도록 선택 끝(end)도 준다(위치와 길이는 코어의 글자 수 기준).
   * 위치 모양은 편집기의 DocumentPosition 과 같다: 평평한 칸 좌표는 바깥 표 기준이고, 안쪽 표는 cellPath 에 전체 경로가 있다.
   */
  cellFocus(index: number, find?: string): CellFocus | null {
    const slot = this.locate(index);
    if (!slot || slot.kind !== 'cell') return null;
    const first = slot.path[0] as CellStep;
    let start = 0;
    let end: number | undefined;
    if (find) {
      const text = this.text(slot);
      const at = text.indexOf(find);
      if (at >= 0) {
        start = codePointLength(text.slice(0, at));
        end = start + codePointLength(find);
      }
    }
    const tooBig = slot.tableWeight > MAX_FOCUS_TABLE_PARAGRAPHS;
    if (tooBig) end = undefined;
    return {
      position: {
        sectionIndex: slot.sec,
        paragraphIndex: slot.host,
        charOffset: start,
        parentParaIndex: slot.host,
        controlIndex: first.controlIndex,
        cellIndex: first.cellIndex,
        cellParaIndex: first.cellParaIndex,
        ...(slot.path.length > 1 ? { cellPath: slot.path.map((step) => ({ ...step })) } : {}),
      },
      ...(end !== undefined ? { end } : {}),
      ...(tooBig ? { tooBig: true } : {}),
    };
  }

  // ───────────────────────── 문단 칸 읽기·쓰기(본문과 표 칸을 같은 방식으로) ─────────────────────────

  private len(slot: Slot): number {
    return slot.kind === 'body' ? this.doc.getParagraphLength(slot.sec, slot.para) : this.doc.getCellParagraphLengthByPath(slot.sec, slot.host, slot.pathJson);
  }

  private text(slot: Slot): string {
    const len = this.len(slot);
    if (len <= 0) return '';
    return slot.kind === 'body' ? this.doc.getTextRange(slot.sec, slot.para, 0, len) : this.doc.getTextInCellByPath(slot.sec, slot.host, slot.pathJson, 0, len);
  }

  private charProps(slot: Slot, offset = 0): CoreChar {
    const raw = slot.kind === 'body' ? this.doc.getCharPropertiesAt(slot.sec, slot.para, offset) : this.doc.getCellCharPropertiesAtByPath(slot.sec, slot.host, slot.pathJson, offset);
    return JSON.parse(raw) as CoreChar;
  }

  /** 문단 서식. 읽을 수 없는 칸(표 안의 표)은 null. */
  private paraProps(slot: Slot): CorePara | null {
    if (slot.kind === 'body') return JSON.parse(this.doc.getParaPropertiesAt(slot.sec, slot.para)) as CorePara;
    if (slot.path.length > 1) return null;
    const step = slot.path[0] as CellStep;
    return JSON.parse(this.doc.getCellParaPropertiesAt(slot.sec, slot.host, step.controlIndex, step.cellIndex, step.cellParaIndex)) as CorePara;
  }

  private applyChar(slot: Slot, start: number, end: number, props: Record<string, unknown>): boolean {
    const json = JSON.stringify(props);
    return ok(slot.kind === 'body' ? this.doc.applyCharFormat(slot.sec, slot.para, start, end, json) : this.doc.applyCharFormatInCellByPath(slot.sec, slot.host, slot.pathJson, start, end, json));
  }

  private applyPara(slot: Slot, props: Record<string, unknown>): boolean {
    const json = JSON.stringify(props);
    if (slot.kind === 'body') return ok(this.doc.applyParaFormat(slot.sec, slot.para, json));
    const step = slot.path[0] as CellStep;
    return slot.path.length === 1 && ok(this.doc.applyParaFormatInCell(slot.sec, slot.host, step.controlIndex, step.cellIndex, step.cellParaIndex, json));
  }

  /**
   * 글자 위치 start 부터 length 글자를 replacement 로 바꾼다(위치와 길이는 코어의 글자 수 기준).
   * 본문은 코어의 글 바꾸기를 쓰고, 표 칸은 코어에 글 바꾸기가 없어서 "새 글을 옛 글 바로 뒤에 넣고 옛 글을 지운다".
   * 이렇게 하면 새 글이 옛 글의 서식을 이어받는다. 옛 글 안에서 글자 모양이 갈린 경우를 위해, 바꾼 뒤에는 옛 글 첫 글자의 글자 모양을 새 글에 그대로 입힌다.
   */
  private replaceRange(slot: Slot, start: number, length: number, replacement: string): boolean {
    if (slot.kind === 'body') return ok(this.doc.replaceText(slot.sec, slot.para, start, length, replacement));

    const added = codePointLength(replacement);
    const shapeBefore = length > 0 && added > 0 ? this.charProps(slot, start).charShapeId : undefined;
    if (added > 0 && !ok(this.doc.insertTextInCellByPath(slot.sec, slot.host, slot.pathJson, start + length, replacement))) return false;
    if (length > 0 && !ok(this.doc.deleteTextInCellByPath(slot.sec, slot.host, slot.pathJson, start, length))) {
      // 새 글은 이미 들어갔다: 지워서 원래대로 돌려 놓는다.
      if (added > 0) this.doc.deleteTextInCellByPath(slot.sec, slot.host, slot.pathJson, start + length, added);
      return false;
    }
    if (shapeBefore !== undefined && this.charProps(slot, start).charShapeId !== shapeBefore) {
      this.doc.setCharShapeIdInCellByPath(slot.sec, slot.host, slot.pathJson, start, start + added, shapeBefore);
    }
    return true;
  }

  // ───────────────────────── 요약 ─────────────────────────

  /** AI 와 서식 점검에 넘길 문서 요약. 글이 있는 문단만 담는다(번호는 건너뛰어도 문서 기준 번호를 그대로 쓴다). */
  summarize(): DocSummary {
    const paragraphs: ParagraphInfo[] = [];
    this.slotList().forEach((slot, index) => {
      const text = this.text(slot);
      if (text.trim().length === 0) return;
      const c = this.charProps(slot);
      const pr = this.paraProps(slot) ?? {};
      const char: CharStyle = {};
      // 대표 글꼴은 한글(첫 칸)의 글꼴이다. 코어의 fontFamily 는 문단 첫 글자의 언어를 따라가서(숫자로 시작하면 영문 칸) 문단마다 달라질 수 있다.
      const family = c.fontFamilies?.[0] || c.fontFamily;
      if (family) char.fontFamily = family;
      if (typeof c.fontSize === 'number') char.fontSizePt = Math.round(c.fontSize) / 100;
      if (c.bold) char.bold = true;
      if (c.italic) char.italic = true;
      if (c.underline) char.underline = true;
      const para: ParaStyle = {};
      const align = toAlign(pr.alignment);
      if (align) para.align = align;
      if (pr.lineSpacingType === 'Percent' && typeof pr.lineSpacing === 'number') para.lineSpacingPct = Math.round(pr.lineSpacing);
      const info: ParagraphInfo = { index, text, char, para };
      if (slot.kind === 'cell') info.cell = slot.place;
      paragraphs.push(info);
    });
    return { kind: this.format, paragraphs, pageCount: this.doc.pageCount() };
  }

  // ───────────────────────── 변경 ─────────────────────────

  /** 변경 묶음을 적용한다. 하나라도 실패하면 모두 되돌리고 실패를 돌려준다. */
  async apply(ops: Op[]): Promise<ApplyResult> {
    // 큰 문서에서는 변경마다 쪽 나누기를 다시 계산하면 한 건에 0.5초씩 걸린다(표가 큰 문서). 묶음 모드로 끝에 한 번만 계산한다.
    const batching = typeof this.doc.beginBatch === 'function' && typeof this.doc.endBatch === 'function';
    if (batching) this.doc.beginBatch?.();
    try {
      return await applyAtomic(async (op) => this.applyOne(op), ops);
    } finally {
      if (batching) {
        try {
          this.doc.endBatch?.();
        } catch {
          // 묶음을 끝내지 못해도 이미 한 변경은 그대로다. 다음 요청에서 다시 읽는다.
        }
      }
    }
  }

  private applyOne(op: Op): OneResult {
    const slot = this.locate(op.paragraph);
    if (!slot) return stale('문서가 바뀌어 해당 문단을 찾을 수 없어요.');
    const cur = this.text(slot);
    if (op.guard !== undefined && op.guard !== textGuard(cur)) return stale('문서가 바뀌어 이 제안을 적용할 수 없어요. 다시 점검해 주세요.');
    try {
      switch (op.type) {
        case 'replaceText':
          return this.replaceText(op, slot, cur);
        case 'setCharStyle':
          return this.setCharStyle(op, slot, cur);
        case 'setParaStyle':
          return this.setParaStyle(op, slot, cur);
      }
    } catch (e) {
      return failed(`한글 편집기에서 변경하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private replaceText(op: Extract<Op, { type: 'replaceText' }>, slot: Slot, cur: string): OneResult {
    if (/[\r\n]/.test(op.replace)) return unsupported('줄바꿈이 들어간 변경은 아직 적용할 수 없어요.');

    let idx: number;
    if (op.find === '') {
      if (op.at === undefined || op.at > cur.length) return stale('끼워 넣을 위치를 찾을 수 없어요.');
      idx = op.at;
    } else if (op.at !== undefined && cur.startsWith(op.find, op.at)) {
      idx = op.at;
    } else {
      idx = cur.indexOf(op.find);
      if (idx < 0) return stale('문서가 바뀌어 고칠 글을 찾을 수 없어요.');
    }

    const start = codePointLength(cur.slice(0, idx));
    const length = codePointLength(op.find);
    const expected = cur.slice(0, idx) + op.replace + cur.slice(idx + op.find.length);
    if (!this.replaceRange(slot, start, length, op.replace)) return failed('한글 편집기가 글을 바꾸지 못했어요.');

    const after = this.text(slot);
    if (after !== expected) {
      // 코어가 예상과 다르게 바꿨다: 가능한 만큼 원래대로 돌려 놓고 실패로 알린다.
      this.replaceRange(slot, start, codePointLength(op.replace), op.find);
      return failed('한글 편집기가 글을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, at: idx, guard: textGuard(after) } };
  }

  private setCharStyle(op: Extract<Op, { type: 'setCharStyle' }>, slot: Slot, cur: string): OneResult {
    const len = codePointLength(cur);
    if (len === 0) return stale('빈 문단에는 서식을 바꿀 수 없어요.');
    const before = this.charProps(slot);
    const s = op.style;
    const props: Record<string, unknown> = {};
    const undo: CharStyle = {};

    if (s.fontFaces) {
      const ids = s.fontFaces.map((name, i) => this.doc.findOrCreateFontIdForLang(i, name));
      if (ids.some((id) => id < 0)) return failed('글꼴을 찾을 수 없어요.');
      props.fontIds = ids;
    } else if (s.fontFamily !== undefined) {
      // 글꼴 목록은 언어(한글·영문·한자·일어·기타·기호·사용자)마다 따로 있고, 같은 글꼴이어도 목록마다 번호가 다를 수 있다
      // (실제 문서에서는 대개 다르다). 그래서 번호 하나를 모든 언어에 쓰지 않고 언어마다 그 글꼴의 번호를 찾아 넣는다.
      const ids = Array.from({ length: 7 }, (_, lang) => this.doc.findOrCreateFontIdForLang(lang, s.fontFamily as string));
      if (ids.some((id) => id < 0)) return failed(`글꼴 "${s.fontFamily}"을(를) 쓸 수 없어요.`);
      props.fontIds = ids;
    }
    if (s.fontFaces || s.fontFamily !== undefined) {
      if (before.fontFamilies?.length === 7) undo.fontFaces = before.fontFamilies;
      else if (before.fontFamily) undo.fontFamily = before.fontFamily;
    }
    if (s.fontSizePt !== undefined) {
      props.fontSize = Math.round(s.fontSizePt * 100);
      if (typeof before.fontSize === 'number') undo.fontSizePt = before.fontSize / 100;
    }
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (s[key] !== undefined) {
        props[key] = s[key];
        undo[key] = Boolean(before[key]);
      }
    }
    if (Object.keys(props).length === 0) return failed('바꿀 서식이 없어요.');

    if (!this.applyChar(slot, 0, len, props)) return failed('한글 편집기가 글자 서식을 바꾸지 못했어요.');

    // 바뀐 결과를 다시 읽어 확인한다. 다르면 되돌리고 실패로 알린다.
    const after = this.charProps(slot);
    const mismatch =
      (props.fontSize !== undefined && Math.round(after.fontSize ?? -1) !== props.fontSize) ||
      (s.fontFamily !== undefined && !s.fontFaces && (after.fontFamilies?.length === 7 ? after.fontFamilies.some((n) => n !== s.fontFamily) : after.fontFamily !== s.fontFamily)) ||
      (s.fontFaces !== undefined && JSON.stringify(after.fontFamilies) !== JSON.stringify(s.fontFaces)) ||
      (['bold', 'italic', 'underline'] as const).some((k) => s[k] !== undefined && Boolean(after[k]) !== s[k]);
    if (mismatch) {
      this.restoreChar(slot, len, undo);
      return failed('한글 편집기가 글자 서식을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'setCharStyle', paragraph: op.paragraph, style: undo, guard: textGuard(cur) } };
  }

  private restoreChar(slot: Slot, len: number, undo: CharStyle): void {
    const props: Record<string, unknown> = {};
    if (undo.fontFaces) props.fontIds = undo.fontFaces.map((n, i) => this.doc.findOrCreateFontIdForLang(i, n));
    else if (undo.fontFamily) props.fontId = this.doc.findOrCreateFontId(undo.fontFamily);
    if (undo.fontSizePt !== undefined) props.fontSize = Math.round(undo.fontSizePt * 100);
    for (const key of ['bold', 'italic', 'underline'] as const) if (undo[key] !== undefined) props[key] = undo[key];
    this.applyChar(slot, 0, len, props);
  }

  private setParaStyle(op: Extract<Op, { type: 'setParaStyle' }>, slot: Slot, cur: string): OneResult {
    const before = this.paraProps(slot);
    if (!before) return unsupported('표 안의 표에 있는 문단의 정렬·줄 간격은 아직 바꿀 수 없어요.');
    const s = op.style;
    const props: Record<string, unknown> = {};
    const undo: ParaStyle = {};

    const align = s.rawAlign ?? s.align;
    if (align !== undefined) {
      props.alignment = align;
      if (before.alignment) {
        undo.rawAlign = before.alignment;
        const a = toAlign(before.alignment);
        if (a) undo.align = a;
      }
    }
    if (s.rawLineSpacing !== undefined || s.lineSpacingPct !== undefined) {
      // 고정값·최소값 같은 방식은 값을 정확히 되돌릴 수 없어서 바꾸지 않는다.
      if (before.lineSpacingType !== 'Percent' || typeof before.lineSpacing !== 'number') {
        return unsupported('이 문단은 줄 간격이 퍼센트가 아닌 방식(고정값 등)이라 바꿀 수 없어요.');
      }
      const target = s.rawLineSpacing ? s.rawLineSpacing.value : (s.lineSpacingPct as number);
      props.lineSpacing = target;
      props.lineSpacingType = 'Percent';
      undo.lineSpacingPct = Math.round(before.lineSpacing);
      undo.rawLineSpacing = { type: 'Percent', value: before.lineSpacing };
    }
    if (Object.keys(props).length === 0) return failed('바꿀 서식이 없어요.');

    if (!this.applyPara(slot, props)) return failed('한글 편집기가 문단 서식을 바꾸지 못했어요.');

    const after = this.paraProps(slot) ?? {};
    const mismatch =
      (props.alignment !== undefined && after.alignment !== props.alignment) ||
      (props.lineSpacing !== undefined && Math.round(after.lineSpacing ?? -1) !== Math.round(props.lineSpacing as number));
    if (mismatch) {
      const restore: Record<string, unknown> = {};
      if (undo.rawAlign) restore.alignment = undo.rawAlign;
      if (undo.rawLineSpacing) {
        restore.lineSpacing = undo.rawLineSpacing.value;
        restore.lineSpacingType = undo.rawLineSpacing.type;
      }
      this.applyPara(slot, restore);
      return failed('한글 편집기가 문단 서식을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'setParaStyle', paragraph: op.paragraph, style: undo, guard: textGuard(cur) } };
  }

  /** 지금 상태를 파일로 만든다. 손실이 있으면 lossCount 가 0 보다 크다. */
  exportBytes(): ExportedBytes {
    const out = this.format === 'hwpx' ? this.doc.exportHwpxWithReport() : this.doc.exportHwpWithReport();
    try {
      const report = JSON.parse(out.contentLoss()) as { count?: number };
      return { bytes: out.takeBytes(), lossCount: typeof report.count === 'number' ? report.count : 0 };
    } finally {
      out.free();
    }
  }
}
