// DOCX 문서의 읽기와 변경. SuperDoc 의 문서 API(extract·replace·format·paragraphs)로 고치고,
// 글꼴·크기 같은 서식은 내보낸 DOCX 의 XML 에서 읽는다(styles.ts).
//
// 문단 번호: extract() 가 돌려주는 본문 블록 목록에서의 순서(0부터, 표 안의 문단 포함) 뒤에,
// 머리말 → 꼬리말 → 각주 → 미주 문단이 이어진다(areas.ts). 본문 밖의 문단은 그 글의 "이야기(story)" 를 문서 API 에 함께 넘겨 고친다.
import { textGuard, type AreaPlace, type CharStyle, type DocSummary, type Op, type ParagraphInfo, type ParaStyle } from '@alldoc/shared';
import { applyAtomic, stale, unsupported, type OneResult } from '../applyOps';
import type { ApplyFailure, ApplyResult } from '../types';
import { readAreas, toPlace, type AreaApi, type AreaRef } from './areas';
import { browserParse, parseDocxParagraphs, parseNoteOrder, usesEvenAndOddHeaders, type FontSlots, type NoteOrder, type ParsedParagraph } from './styles';
import { decodeUtf8, readZipFiles } from './zip';

export interface BlockLike {
  nodeId: string;
  type: string;
  text: string;
  /** 머리말·꼬리말·각주·미주 안의 문단이면 그 자리. 본문(표 안 포함)의 문단이면 없다. */
  area?: AreaRef;
}

interface Receipt {
  success: boolean;
  failure?: { message?: string; code?: string };
}

/** SuperDoc 의 문서 API 중 이 모듈이 쓰는 부분만 좁혀 둔 약속. 머리말·꼬리말·각주를 읽는 부분(AreaApi)은 없어도 본문은 다룬다. */
export interface DocxHost {
  doc: {
    extract(input: Record<string, never>): Promise<{ blocks: BlockLike[]; revision: string }>;
    replace(input: unknown): Promise<Receipt>;
    format: { apply(input: unknown): Promise<Receipt> };
    paragraphs: { setAlignment(input: unknown): Promise<Receipt>; setSpacing(input: unknown): Promise<Receipt> };
  } & AreaApi;
  exportDocx(): Promise<Blob>;
}

const failed = (message: string): ApplyFailure => ({ ok: false, reason: 'failed', message });

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'listItem']);
export const isTextBlock = (b: BlockLike): boolean => TEXT_BLOCKS.has(b.type);

/** 글 범위. 본문 밖의 문단이면 그 이야기(story)를 함께 적는다. */
const selection = (block: BlockLike, start: number, end: number) => ({
  kind: 'selection' as const,
  start: { kind: 'text' as const, blockId: block.nodeId, offset: start },
  end: { kind: 'text' as const, blockId: block.nodeId, offset: end },
  ...(block.area ? { story: block.area.story } : {}),
});

/** 글 속의 각주·미주 표시나 그림 같은 개체 자리. 이 자리를 바꾸는 글 바꾸기는 개체(와 각주 내용)를 지워 버리므로 하지 않는다. */
const OBJECT_CHAR = '\uFFFC';

/** 서식을 찾는 열쇠. 본문 밖의 문단은 번호가 파일마다 따로 매겨질 수 있어 어느 파일의 문단인지를 앞에 붙인다. */
const styleKey = (b: BlockLike): string => (b.area ? `${b.area.part}#${b.nodeId}` : b.nodeId);

const normalize = (s: string): string => s.replace(/[\s\uFFFC]+/g, '');

/** 블록과 XML 문단을 짝짓는다: 문단 번호(w14:paraId)가 같으면 그것으로, 아니면 글이 같은 것을 순서대로. */
export function matchStyles(blocks: BlockLike[], paras: ParsedParagraph[]): Map<string, ParsedParagraph> {
  const out = new Map<string, ParsedParagraph>();
  const byId = new Map<string, ParsedParagraph>();
  for (const p of paras) if (p.paraId) byId.set(p.paraId, p);
  let cursor = 0;
  for (const b of blocks) {
    if (!isTextBlock(b)) continue;
    const hit = byId.get(b.nodeId);
    if (hit) {
      out.set(b.nodeId, hit);
      continue;
    }
    if (normalize(b.text) === '') continue;
    for (let i = cursor; i < paras.length; i++) {
      const p = paras[i] as ParsedParagraph;
      if (normalize(p.text) === normalize(b.text)) {
        out.set(b.nodeId, p);
        cursor = i + 1;
        break;
      }
    }
  }
  return out;
}

interface Snapshot {
  revision: string;
  /** 본문 블록 뒤에 머리말·꼬리말·각주·미주 문단이 이어진다 */
  blocks: BlockLike[];
  /** 그중 본문 밖의 문단들 */
  areas: BlockLike[];
  styles: Map<string, ParsedParagraph>;
  /** 홀수·짝수 쪽 머리말을 따로 쓰는 문서인가 */
  evenOdd: boolean;
  /** 본문에서 각주·미주 표시가 나오는 순서(번호를 이 순서로 센다) */
  noteOrder: NoteOrder;
}

/**
 * 변경 묶음 하나를 적용하는 동안 쓰는 작업 상태.
 * 문서를 읽은 결과에 우리가 한 변경을 반영해 가며 쓴다. 변경마다 문서를 다시 읽으면 큰 문서에서 너무 느리다
 * (300문단 문서에서 문단 목록 읽기 한 번이 0.13초). 대신 묶음이 끝난 뒤 문서를 한 번 다시 읽어 예상과 같은지 확인한다.
 */
interface Session {
  blocks: BlockLike[];
  /** blocks 의 앞쪽 몇 개가 본문 블록인가(나머지는 본문 밖의 문단) */
  bodyCount: number;
  /** 본문 밖의 문단을 읽어 blocks 뒤에 붙였는가. 그곳을 고치는 변경이 있을 때만 읽는다. */
  withAreas: boolean;
  /** 글자·문단 서식. 서식을 바꾸는 변경이 처음 나올 때 한 번만 읽는다. */
  styles: Map<string, ParsedParagraph> | null;
}

const SLOTS = ['ascii', 'hAnsi', 'eastAsia', 'cs'] as const;

/** 바꾸려는 글꼴 칸. rawFonts(되돌리기용 칸별 값)가 있으면 그대로, fontFamily 만 있으면 모든 칸을 그 글꼴로. */
function requestedFonts(style: CharStyle): FontSlots | undefined {
  if (style.rawFonts) return { ...style.rawFonts };
  if (style.fontFamily !== undefined) return { ascii: style.fontFamily, hAnsi: style.fontFamily, eastAsia: style.fontFamily, cs: style.fontFamily };
  return undefined;
}

/** 칸별 글꼴에서 대표 글꼴(한글 칸 우선) */
const representative = (f: FontSlots): string | undefined => f.eastAsia ?? f.ascii ?? f.hAnsi;

export class DocxModel {
  private cache: Omit<Snapshot, 'blocks'> | null = null;
  /** 마지막으로 읽은 문서가 홀수·짝수 쪽 머리말을 따로 쓰는가(읽기 전에는 모른다) */
  private evenOdd = false;
  /** 마지막으로 읽은 문서의 각주·미주 순서 */
  private noteOrder: NoteOrder = { footnote: [], endnote: [] };

  constructor(private readonly host: DocxHost) {}

  /**
   * 내보낸 DOCX 의 XML 에서 문단마다 글자·문단 서식을 읽는다. 본문은 문단 번호(w14:paraId)나 글로 짝짓고,
   * 머리말·꼬리말·각주·미주는 그 글이 든 파일에서 문단 번호로 짝짓는다.
   */
  private async readStyles(blocks: BlockLike[]): Promise<{ styles: Map<string, ParsedParagraph>; evenOdd: boolean; noteOrder: NoteOrder }> {
    const blob = await this.host.exportDocx();
    const parts = [...new Set(blocks.flatMap((b) => (b.area ? [b.area.part] : [])))];
    const files = await readZipFiles(new Uint8Array(await blob.arrayBuffer()), ['word/document.xml', 'word/styles.xml', 'word/settings.xml', ...parts]);
    const docXml = files.get('word/document.xml');
    if (!docXml) throw new Error('내보낸 DOCX 에서 본문을 찾을 수 없어요.');
    const stylesXml = files.get('word/styles.xml');
    const sheet = stylesXml ? decodeUtf8(stylesXml) : null;
    const styles = matchStyles(
      blocks.filter((b) => !b.area),
      parseDocxParagraphs(decodeUtf8(docXml), sheet, browserParse),
    );
    for (const part of parts) {
      const xml = files.get(part);
      if (!xml) continue;
      const byId = new Map<string, ParsedParagraph>();
      for (const p of parseDocxParagraphs(decodeUtf8(xml), sheet, browserParse)) if (p.paraId) byId.set(p.paraId, p);
      for (const b of blocks) {
        const hit = b.area?.part === part ? byId.get(b.nodeId) : undefined;
        if (!hit) continue;
        const { cell: _cell, ...rest } = hit; // 머리말 안의 표 칸 위치는 쓰지 않는다(위치는 머리말·꼬리말로 말한다).
        styles.set(styleKey(b), rest);
      }
    }
    const settings = files.get('word/settings.xml');
    const evenOdd = usesEvenAndOddHeaders(settings ? decodeUtf8(settings) : null, browserParse);
    const noteOrder = parseNoteOrder(decodeUtf8(docXml), browserParse);
    this.evenOdd = evenOdd;
    this.noteOrder = noteOrder;
    return { styles, evenOdd, noteOrder };
  }

  /** 지금 문서의 블록 목록과 서식. 문서 변경 번호(revision)가 같으면 이전에 읽은 서식과 본문 밖의 문단을 다시 쓴다. */
  private async snapshot(fresh = false): Promise<Snapshot> {
    const ex = await this.host.doc.extract({});
    const c = this.cache;
    if (!fresh && c && c.revision === ex.revision) return { ...c, blocks: [...ex.blocks, ...c.areas] };
    const areas = (await readAreas(this.host.doc)).blocks;
    const blocks = [...ex.blocks, ...areas];
    const { styles, evenOdd, noteOrder } = await this.readStyles(blocks);
    this.cache = { revision: ex.revision, areas, styles, evenOdd, noteOrder };
    return { revision: ex.revision, blocks, areas, styles, evenOdd, noteOrder };
  }

  /** 문단 번호로 문단을 찾는 데 쓰는 블록 목록(summarize 와 같은 번호). 화면이 "고칠 곳"을 문서 위에 그릴 때 쓴다. */
  async blocks(): Promise<BlockLike[]> {
    const ex = await this.host.doc.extract({});
    const c = this.cache;
    if (c && c.revision === ex.revision) return [...ex.blocks, ...c.areas];
    return [...ex.blocks, ...(await readAreas(this.host.doc)).blocks];
  }

  /** 본문 밖 문단의 위치(카드에 보이는 것과 같다) */
  placeOf(area: AreaRef): AreaPlace {
    return toPlace(area, this.evenOdd, this.noteOrder);
  }

  async summarize(): Promise<DocSummary> {
    const snap = await this.snapshot();
    const paragraphs: ParagraphInfo[] = [];
    snap.blocks.forEach((b, index) => {
      if (!isTextBlock(b) || b.text.trim() === '') return;
      const st = snap.styles.get(styleKey(b));
      // 글상자 안의 문단은 목록에는 오지만 본문 문단으로는 고칠 수 없다("Block not found"). AI 가 고치려 들지 않게 요약에서 뺀다(번호는 그대로).
      if (st?.inTextBox) return;
      const place = b.area ? { area: toPlace(b.area, snap.evenOdd, snap.noteOrder) } : st?.cell ? { cell: st.cell } : {};
      paragraphs.push({ index, text: b.text, char: st?.char ?? {}, para: st?.para ?? {}, ...place });
    });
    return { kind: 'docx', paragraphs };
  }

  async apply(ops: Op[]): Promise<ApplyResult> {
    try {
      const session = await this.open(ops);
      const result = await applyAtomic((op) => this.applyOne(session, op), ops);
      if (!result.ok) return result;
      // 고친 결과를 다시 읽어 예상과 같은지 확인한다. 다르면 모두 되돌린다.
      const problem = await this.verify(session, ops);
      if (problem) {
        await this.rollback(result.inverse);
        return failed(problem);
      }
      return result;
    } catch (e) {
      return failed(`Word 편집기에서 변경하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** 변경 묶음을 적용할 작업 상태를 연다. 본문 밖의 문단은 그곳을 고치는 변경이 있을 때만 읽는다(본문만 고칠 때는 그만큼 빠르다). */
  private async open(ops: Op[]): Promise<Session> {
    const ex = await this.host.doc.extract({});
    const blocks = ex.blocks.map((b) => ({ ...b }));
    const bodyCount = blocks.length;
    const withAreas = ops.some((o) => o.paragraph >= bodyCount);
    if (withAreas) blocks.push(...(await readAreas(this.host.doc)).blocks);
    return { blocks, bodyCount, withAreas, styles: null };
  }

  private async styleOf(s: Session, block: BlockLike): Promise<ParsedParagraph | undefined> {
    s.styles ??= (await this.readStyles(s.blocks)).styles;
    return s.styles.get(styleKey(block));
  }

  /** rollback: 되돌리는 중에는 문서가 예상과 다를 수 있어, 지문 확인과 이전 서식 읽기를 하지 않고 가능한 만큼 되돌린다. */
  private async applyOne(s: Session, op: Op, rollback = false): Promise<OneResult> {
    try {
      const block = s.blocks[op.paragraph];
      if (!block || !isTextBlock(block)) return stale('문서가 바뀌어 해당 문단을 찾을 수 없어요.');
      if (!rollback && op.guard !== undefined && op.guard !== textGuard(block.text)) return stale('문서가 바뀌어 이 제안을 적용할 수 없어요. 다시 점검해 주세요.');
      switch (op.type) {
        case 'replaceText':
          return await this.replaceText(s, op, block);
        case 'setCharStyle':
          return await this.setCharStyle(s, op, block, rollback);
        case 'setParaStyle':
          return await this.setParaStyle(s, op, block, rollback);
      }
    } catch (e) {
      return failed(`Word 편집기에서 변경하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async replaceText(_s: Session, op: Extract<Op, { type: 'replaceText' }>, block: BlockLike): Promise<OneResult> {
    if (/[\r\n]/.test(op.replace)) return unsupported('줄바꿈이 들어간 변경은 아직 적용할 수 없어요.');
    if (op.find.includes(OBJECT_CHAR) || op.replace.includes(OBJECT_CHAR)) return unsupported('각주 표시나 그림 같은 개체가 든 글은 바꿀 수 없어요.');
    const cur = block.text;
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
    const receipt = await this.host.doc.replace({ target: selection(block, idx, idx + op.find.length), text: op.replace, ...(block.area ? { in: block.area.story } : {}) });
    if (!receipt.success) return failed(receipt.failure?.message ?? 'Word 편집기가 글을 바꾸지 못했어요.');

    const next = cur.slice(0, idx) + op.replace + cur.slice(idx + op.find.length);
    block.text = next;
    return { ok: true, inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, at: idx, guard: textGuard(next) } };
  }

  private async setCharStyle(s: Session, op: Extract<Op, { type: 'setCharStyle' }>, block: BlockLike, rollback: boolean): Promise<OneResult> {
    if (block.text.length === 0) return stale('빈 문단에는 서식을 바꿀 수 없어요.');
    const before = rollback ? undefined : await this.styleOf(s, block);
    if (!rollback && !before) return failed('이 문단의 서식을 읽지 못해 바꿀 수 없어요.');
    const st = op.style;
    const inline: Record<string, unknown> = {};
    const undo: CharStyle = {};

    const fonts = requestedFonts(st);
    if (fonts) {
      // 글꼴 칸 전체를 한 번에 바꾼다(SuperDoc 은 rFonts 를 통째로 바꾸므로 빠진 칸은 지워진다).
      // 한글 글이 실제로 바뀌려면 한글(동아시아) 칸까지 들어 있어야 한다.
      inline.rFonts = Object.fromEntries(SLOTS.map((k) => [k, fonts[k] ?? null]));
      if (before) {
        undo.rawFonts = { ...before.fonts };
        if (before.char.fontFamily) undo.fontFamily = before.char.fontFamily;
      }
    }
    if (st.fontSizePt !== undefined) {
      inline.fontSize = st.fontSizePt;
      if (before) {
        if (before.char.fontSizePt === undefined) return failed('이 문단의 글자 크기를 읽지 못해 바꿀 수 없어요.');
        undo.fontSizePt = before.char.fontSizePt;
      }
    }
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (st[key] !== undefined) {
        inline[key] = st[key];
        if (before) undo[key] = Boolean(before.char[key]);
      }
    }
    if (Object.keys(inline).length === 0) return failed('바꿀 서식이 없어요.');

    const receipt = await this.host.doc.format.apply({ target: selection(block, 0, block.text.length), inline, ...(block.area ? { in: block.area.story } : {}) });
    if (!receipt.success) return failed(receipt.failure?.message ?? 'Word 편집기가 글자 서식을 바꾸지 못했어요.');

    if (before) {
      // 이 문단의 서식 상태를 바꾼 값으로 고쳐 둔다(같은 묶음의 뒤쪽 변경이 "이전 서식"으로 읽는다).
      const next: CharStyle = { ...before.char };
      if (fonts) {
        before.fonts = { ...fonts };
        const family = representative(fonts);
        if (family) next.fontFamily = family;
        else delete next.fontFamily;
      }
      if (st.fontSizePt !== undefined) next.fontSizePt = st.fontSizePt;
      for (const key of ['bold', 'italic', 'underline'] as const) {
        if (st[key] === undefined) continue;
        if (st[key]) next[key] = true;
        else delete next[key];
      }
      before.char = next;
    }
    return { ok: true, inverse: { type: 'setCharStyle', paragraph: op.paragraph, style: undo, guard: textGuard(block.text) } };
  }

  private async setParaStyle(s: Session, op: Extract<Op, { type: 'setParaStyle' }>, block: BlockLike, rollback: boolean): Promise<OneResult> {
    const before = rollback ? undefined : await this.styleOf(s, block);
    if (!rollback && !before) return failed('이 문단의 서식을 읽지 못해 바꿀 수 없어요.');
    const st = op.style;
    const address = { kind: 'block' as const, nodeType: block.type as 'paragraph' | 'heading' | 'listItem', nodeId: block.nodeId, ...(block.area ? { story: block.area.story } : {}) };
    const undo: ParaStyle = {};

    if (st.align === undefined && st.lineSpacingPct === undefined) return failed('바꿀 서식이 없어요.');
    if (before) {
      if (st.align !== undefined) {
        if (before.para.align === undefined) return unsupported('이 문단의 정렬(배분 정렬 등)은 정확히 되돌릴 수 없어서 바꾸지 않아요.');
        undo.align = before.para.align;
      }
      if (st.lineSpacingPct !== undefined) {
        // 고정값·최소값 같은 줄 간격은 퍼센트로 말할 수 없어서 바꾸지 않는다.
        if (before.para.lineSpacingPct === undefined) return unsupported('이 문단은 줄 간격이 퍼센트가 아닌 방식(고정값 등)이라 바꿀 수 없어요.');
        undo.lineSpacingPct = before.para.lineSpacingPct;
      }
    } else {
      // 되돌리는 중: 되돌릴 값(이전 값)이 그대로 들어 있다.
      if (st.align !== undefined) undo.align = st.align;
      if (st.lineSpacingPct !== undefined) undo.lineSpacingPct = st.lineSpacingPct;
    }

    if (st.align !== undefined) {
      const r = await this.host.doc.paragraphs.setAlignment({ target: address, alignment: st.align });
      if (!r.success) return failed(r.failure?.message ?? 'Word 편집기가 정렬을 바꾸지 못했어요.');
    }
    if (st.lineSpacingPct !== undefined) {
      const r = await this.host.doc.paragraphs.setSpacing({ target: address, line: Math.round(st.lineSpacingPct * 2.4), lineRule: 'auto' });
      if (!r.success) return failed(r.failure?.message ?? 'Word 편집기가 줄 간격을 바꾸지 못했어요.');
    }
    if (before) before.para = { ...before.para, ...st };
    return { ok: true, inverse: { type: 'setParaStyle', paragraph: op.paragraph, style: undo, guard: textGuard(block.text) } };
  }

  /** 묶음이 끝난 뒤 문서를 다시 읽어, 우리가 예상한 상태와 같은지 확인한다. 다르면 사용자에게 보일 안내 문장을 돌려준다. */
  private async verify(s: Session, ops: Op[]): Promise<string | null> {
    const ex = await this.host.doc.extract({});
    const mismatch = 'Word 편집기가 글을 예상과 다르게 바꿔서 변경을 취소했어요.';
    if (ex.blocks.length !== s.bodyCount || ex.blocks.some((b, i) => b.text !== (s.blocks[i] as BlockLike).text)) return mismatch;
    // 본문 밖의 글도 읽었다면 다시 읽어 같은 문단들이 예상한 글로 남았는지 본다.
    const areas = s.withAreas ? (await readAreas(this.host.doc)).blocks : [];
    if (s.withAreas) {
      const want = s.blocks.slice(s.bodyCount);
      if (areas.length !== want.length || areas.some((b, i) => b.text !== (want[i] as BlockLike).text || b.nodeId !== (want[i] as BlockLike).nodeId)) return mismatch;
    }
    if (!ops.some((o) => o.type !== 'replaceText')) return null;

    // 문단마다, 이 묶음이 마지막으로 정한 서식 값
    const wantChar = new Map<number, CharStyle>();
    const wantPara = new Map<number, ParaStyle>();
    for (const op of ops) {
      if (op.type === 'setCharStyle') {
        const prev = { ...wantChar.get(op.paragraph) };
        // 글꼴은 나중 변경이 앞의 것을 통째로 덮는다(칸별 값과 글꼴 이름 중 어느 쪽으로 정했든).
        if (op.style.rawFonts !== undefined || op.style.fontFamily !== undefined) {
          delete prev.rawFonts;
          delete prev.fontFamily;
        }
        wantChar.set(op.paragraph, { ...prev, ...op.style });
      } else if (op.type === 'setParaStyle') {
        wantPara.set(op.paragraph, { ...wantPara.get(op.paragraph), ...op.style });
      }
    }

    const blocks = [...ex.blocks, ...areas];
    const { styles, evenOdd, noteOrder } = await this.readStyles(blocks);
    // 본문 밖의 문단까지 읽었을 때만 다음 요약에 쓸 수 있게 간직한다(아니면 요약이 다시 읽는다).
    this.cache = s.withAreas ? { revision: ex.revision, areas, styles, evenOdd, noteOrder } : null;
    for (const [paragraph, want] of wantChar) {
      const now = styles.get(styleKey(blocks[paragraph] as BlockLike));
      if (!now) return 'Word 편집기에서 바뀐 서식을 확인하지 못해 변경을 취소했어요.';
      const fonts = requestedFonts(want);
      const family = fonts ? representative(fonts) : undefined;
      const bad =
        (family !== undefined && now.char.fontFamily !== family) ||
        (want.fontSizePt !== undefined && now.char.fontSizePt !== want.fontSizePt) ||
        (['bold', 'italic', 'underline'] as const).some((k) => want[k] !== undefined && Boolean(now.char[k]) !== want[k]);
      if (bad) return 'Word 편집기가 글자 서식을 예상과 다르게 바꿔서 변경을 취소했어요.';
    }
    for (const [paragraph, want] of wantPara) {
      const now = styles.get(styleKey(blocks[paragraph] as BlockLike));
      if (!now) return 'Word 편집기에서 바뀐 서식을 확인하지 못해 변경을 취소했어요.';
      if ((want.align !== undefined && now.para.align !== want.align) || (want.lineSpacingPct !== undefined && now.para.lineSpacingPct !== want.lineSpacingPct)) {
        return 'Word 편집기가 문단 서식을 예상과 다르게 바꿔서 변경을 취소했어요.';
      }
    }
    return null;
  }

  /** 확인에서 문제가 나왔을 때 이미 한 변경을 거꾸로 되돌린다. 문서를 새로 읽어 시작하고, 되돌리다 실패해도 가능한 만큼 계속한다. */
  private async rollback(inverse: Op[]): Promise<void> {
    try {
      const s = await this.open(inverse);
      for (const inv of inverse) await this.applyOne(s, inv, true);
    } catch {
      // 되돌리지 못해도 방법이 없다. 호출한 쪽이 실패를 알린다.
    }
  }
}
