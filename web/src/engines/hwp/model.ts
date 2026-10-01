// 한글(HWP·HWPX) 문서의 읽기와 변경. @rhwp/core(WASM)의 문서 객체를 감싸서 화면과 무관하게 동작한다.
//
// 문단 번호: 구역(section)을 이어 붙인 본문 문단의 번호(0부터). 표 안, 머리말·꼬리말, 각주의 글은 다루지 않는다.
// 글자 위치: 코어는 유니코드 "글자"(코드 포인트) 단위로 센다. 자바스크립트 문자열 위치(UTF-16)와 다를 수 있어 바꿔서 쓴다.
import {
  textGuard,
  type Align,
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
}

export interface ExportReportLike {
  contentLoss(): string;
  takeBytes(): Uint8Array;
  free(): void;
}

export type HwpFormat = 'hwp' | 'hwpx';

interface Loc {
  sec: number;
  para: number;
}

const ALIGNS: readonly string[] = ['left', 'center', 'right', 'justify'];

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
  private readonly starts: number[] = [];

  constructor(
    private readonly doc: HwpDocLike,
    readonly format: HwpFormat,
  ) {
    let total = 0;
    for (let s = 0; s < doc.getSectionCount(); s++) {
      this.starts.push(total);
      total += doc.getParagraphCount(s);
    }
    this.total = total;
  }

  readonly total: number;

  private locate(index: number): Loc | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.total) return null;
    for (let s = this.starts.length - 1; s >= 0; s--) {
      const start = this.starts[s] as number;
      if (index >= start) {
        const para = index - start;
        return para < this.doc.getParagraphCount(s) ? { sec: s, para } : null;
      }
    }
    return null;
  }

  /** 편집기에서 이 문단으로 이동하는 데 쓰는 위치(구역, 구역 안 문단 번호, 글자 수) */
  paragraphTarget(index: number): { section: number; paragraph: number; length: number } | null {
    const loc = this.locate(index);
    return loc ? { section: loc.sec, paragraph: loc.para, length: this.doc.getParagraphLength(loc.sec, loc.para) } : null;
  }

  private text(loc: Loc): string {
    const len = this.doc.getParagraphLength(loc.sec, loc.para);
    return len > 0 ? this.doc.getTextRange(loc.sec, loc.para, 0, len) : '';
  }

  private charProps(loc: Loc): CoreChar {
    return JSON.parse(this.doc.getCharPropertiesAt(loc.sec, loc.para, 0)) as CoreChar;
  }

  private paraProps(loc: Loc): CorePara {
    return JSON.parse(this.doc.getParaPropertiesAt(loc.sec, loc.para)) as CorePara;
  }

  /** AI 와 서식 점검에 넘길 문서 요약. 글이 있는 문단만 담는다(번호는 건너뛰어도 문서 기준 번호를 그대로 쓴다). */
  summarize(): DocSummary {
    const paragraphs: ParagraphInfo[] = [];
    for (let s = 0; s < this.starts.length; s++) {
      const count = this.doc.getParagraphCount(s);
      for (let p = 0; p < count; p++) {
        const loc = { sec: s, para: p };
        const text = this.text(loc);
        if (text.trim().length === 0) continue;
        const c = this.charProps(loc);
        const pr = this.paraProps(loc);
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
        paragraphs.push({ index: (this.starts[s] as number) + p, text, char, para });
      }
    }
    return { kind: this.format, paragraphs, pageCount: this.doc.pageCount() };
  }

  /** 변경 묶음을 적용한다. 하나라도 실패하면 모두 되돌리고 실패를 돌려준다. */
  apply(ops: Op[]): Promise<ApplyResult> {
    return applyAtomic(async (op) => this.applyOne(op), ops);
  }

  private applyOne(op: Op): OneResult {
    const loc = this.locate(op.paragraph);
    if (!loc) return stale('문서가 바뀌어 해당 문단을 찾을 수 없어요.');
    const cur = this.text(loc);
    if (op.guard !== undefined && op.guard !== textGuard(cur)) return stale('문서가 바뀌어 이 제안을 적용할 수 없어요. 다시 점검해 주세요.');
    try {
      switch (op.type) {
        case 'replaceText':
          return this.replaceText(op, loc, cur);
        case 'setCharStyle':
          return this.setCharStyle(op, loc, cur);
        case 'setParaStyle':
          return this.setParaStyle(op, loc, cur);
      }
    } catch (e) {
      return failed(`한글 편집기에서 변경하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private replaceText(op: Extract<Op, { type: 'replaceText' }>, loc: Loc, cur: string): OneResult {
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
    const raw = this.doc.replaceText(loc.sec, loc.para, start, length, op.replace);
    if (!ok(raw)) return failed('한글 편집기가 글을 바꾸지 못했어요.');

    const after = this.text(loc);
    if (after !== expected) {
      // 코어가 예상과 다르게 바꿨다: 가능한 만큼 원래대로 돌려 놓고 실패로 알린다.
      this.doc.replaceText(loc.sec, loc.para, start, codePointLength(op.replace), op.find);
      return failed('한글 편집기가 글을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, at: idx, guard: textGuard(after) } };
  }

  private setCharStyle(op: Extract<Op, { type: 'setCharStyle' }>, loc: Loc, cur: string): OneResult {
    const len = codePointLength(cur);
    if (len === 0) return stale('빈 문단에는 서식을 바꿀 수 없어요.');
    const before = this.charProps(loc);
    const s = op.style;
    const props: Record<string, unknown> = {};
    const undo: CharStyle = {};

    if (s.fontFaces) {
      const ids = s.fontFaces.map((name, i) => this.doc.findOrCreateFontIdForLang(i, name));
      if (ids.some((id) => id < 0)) return failed('글꼴을 찾을 수 없어요.');
      props.fontIds = ids;
    } else if (s.fontFamily !== undefined) {
      const id = this.doc.findOrCreateFontId(s.fontFamily);
      if (id < 0) return failed(`글꼴 "${s.fontFamily}"을(를) 쓸 수 없어요.`);
      props.fontId = id;
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

    if (!ok(this.doc.applyCharFormat(loc.sec, loc.para, 0, len, JSON.stringify(props)))) return failed('한글 편집기가 글자 서식을 바꾸지 못했어요.');

    // 바뀐 결과를 다시 읽어 확인한다. 다르면 되돌리고 실패로 알린다.
    const after = this.charProps(loc);
    const mismatch =
      (props.fontSize !== undefined && Math.round(after.fontSize ?? -1) !== props.fontSize) ||
      (s.fontFamily !== undefined && !s.fontFaces && (after.fontFamilies?.length === 7 ? after.fontFamilies.some((n) => n !== s.fontFamily) : after.fontFamily !== s.fontFamily)) ||
      (s.fontFaces !== undefined && JSON.stringify(after.fontFamilies) !== JSON.stringify(s.fontFaces)) ||
      (['bold', 'italic', 'underline'] as const).some((k) => s[k] !== undefined && Boolean(after[k]) !== s[k]);
    if (mismatch) {
      this.restoreChar(loc, len, undo);
      return failed('한글 편집기가 글자 서식을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'setCharStyle', paragraph: op.paragraph, style: undo, guard: textGuard(cur) } };
  }

  private restoreChar(loc: Loc, len: number, undo: CharStyle): void {
    const props: Record<string, unknown> = {};
    if (undo.fontFaces) props.fontIds = undo.fontFaces.map((n, i) => this.doc.findOrCreateFontIdForLang(i, n));
    else if (undo.fontFamily) props.fontId = this.doc.findOrCreateFontId(undo.fontFamily);
    if (undo.fontSizePt !== undefined) props.fontSize = Math.round(undo.fontSizePt * 100);
    for (const key of ['bold', 'italic', 'underline'] as const) if (undo[key] !== undefined) props[key] = undo[key];
    this.doc.applyCharFormat(loc.sec, loc.para, 0, len, JSON.stringify(props));
  }

  private setParaStyle(op: Extract<Op, { type: 'setParaStyle' }>, loc: Loc, cur: string): OneResult {
    const before = this.paraProps(loc);
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

    if (!ok(this.doc.applyParaFormat(loc.sec, loc.para, JSON.stringify(props)))) return failed('한글 편집기가 문단 서식을 바꾸지 못했어요.');

    const after = this.paraProps(loc);
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
      this.doc.applyParaFormat(loc.sec, loc.para, JSON.stringify(restore));
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
