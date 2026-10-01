// 시험 전용: SuperDoc 의 문서 API 를 흉내 내는 메모리 문서. 화면 코드에서는 쓰지 않는다.
// 실제 편집기에서 확인한 동작을 따른다: 본문은 extract(), 머리말·꼬리말·각주·미주는 "이야기(story)" 를 지정해 blocks.list·find·getNode 로 읽고
// replace·format·paragraphs 에 같은 이야기를 적어 고친다. 이야기를 잘못 적으면(본문 문단에 이야기를 적거나, 머리말 문단에 빠뜨리면) 오류를 낸다.
import type { Story } from './areas';
import { makeDocxBytes, mapParas, placeHeadersFooters, shownText, type AreaItems, type DocxAreas, type ParaSpec, type TableSpec } from './fixtures';
import type { DocxHost } from './model';

const storyKey = (s: Story): string => (s.storyType === 'headerFooterPart' ? `part:${s.refId}` : `${s.storyType}:${s.noteId}`);

interface FakeStory {
  story: Story;
  /** 목록 API 에 나오는 최상위 블록들(표는 표 하나로 나온다) */
  items: AreaItems;
  /** 표 칸 안까지 문서 순서로 늘어놓은 문단들 */
  flat: ParaSpec[];
}

/** 표 칸 안까지 문서 순서로 늘어놓는다. 글상자 안의 문단은 편집기처럼 그것을 단 문단 바로 다음에 온다. */
const flatten = (items: AreaItems): ParaSpec[] => {
  const out: ParaSpec[] = [];
  mapParas(items, (p) => {
    out.push(p);
    if (p.textBox) out.push(p.textBox);
    return p;
  });
  return out;
};

export class FakeDocx {
  /** 문서 순서대로 늘어놓은 본문 문단(표 칸 안 포함). items 안의 문단과 같은 객체다. */
  paras: ParaSpec[];
  /** 본문의 문단과 표로 이루어진 구조 */
  items: Array<ParaSpec | TableSpec>;
  /** 머리말·꼬리말·각주·미주. 문단은 편집기가 번호(paraId)를 붙인 복사본이다. */
  areas: DocxAreas = {};
  rev = 0;
  extractCount = 0;
  exportCount = 0;
  /** 머리말·각주를 읽는 API 를 부른 횟수(footnotes.list 기준) */
  areaReadCount = 0;
  /** 이 호출은 성공했다고 답하면서 실제로는 아무것도 바꾸지 않는다 */
  ignore = new Set<'replace' | 'format' | 'align' | 'spacing'>();
  /** 글을 바꿀 때 예상과 다르게 바꾼다(끝에 "!" 를 붙인다) */
  mangleReplace = false;
  /** 내보낸 DOCX 에 문단 번호(w14:paraId)를 쓰지 않는다 */
  exportParaIds = true;
  /** 머리말·각주를 읽는 API 가 오류를 낸다 */
  areaApiBroken = false;
  /** 목록 API 가 한 번에 주는 개수(작게 하면 이어 읽기를 시험할 수 있다) */
  pageSize = 1000;

  private stories: FakeStory[] = [];
  /** 글상자 안의 문단 번호들. 본문 문단으로는 찾을 수 없다(실제 편집기가 "Block not found" 를 낸다). */
  private textBoxIds = new Set<string>();

  constructor(items: Array<ParaSpec | TableSpec>, areas: DocxAreas = {}) {
    let n = 0;
    const copy = (p: ParaSpec): ParaSpec => ({ ...p, rFonts: p.rFonts ? { ...p.rFonts } : undefined, paraId: String(++n).padStart(8, '0'), ...(p.textBox ? { textBox: copy(p.textBox) } : {}) });
    this.items = mapParas(items, copy);
    this.paras = flatten(this.items);
    for (const p of this.paras) if (p.textBox) this.textBoxIds.add(p.textBox.paraId as string);

    const owned: DocxAreas = { ...(areas.evenAndOdd ? { evenAndOdd: true } : {}) };
    for (const key of ['header', 'firstHeader', 'evenHeader', 'footer', 'firstFooter', 'evenFooter'] as const) {
      if (areas[key]) owned[key] = mapParas(areas[key], copy);
    }
    if (areas.footnotes) owned.footnotes = areas.footnotes.map((paras) => paras.map(copy));
    if (areas.endnotes) owned.endnotes = areas.endnotes.map((paras) => paras.map(copy));
    this.areas = owned;

    for (const hf of placeHeadersFooters(owned)) {
      this.stories.push({ story: { kind: 'story', storyType: 'headerFooterPart', refId: hf.refId }, items: hf.items, flat: flatten(hf.items) });
    }
    (owned.footnotes ?? []).forEach((paras, i) => this.stories.push({ story: { kind: 'story', storyType: 'footnote', noteId: String(i + 1) }, items: paras, flat: paras }));
    (owned.endnotes ?? []).forEach((paras, i) => this.stories.push({ story: { kind: 'story', storyType: 'endnote', noteId: String(i + 1) }, items: paras, flat: paras }));
  }

  /** 본문 밖의 문단 전체(머리말 → 꼬리말 → 각주 → 미주 순서) */
  get areaParas(): ParaSpec[] {
    return this.stories.flatMap((s) => s.flat);
  }

  private find(story: Story | undefined): FakeStory | undefined {
    return story ? this.stories.find((s) => storyKey(s.story) === storyKey(story)) : undefined;
  }

  /** 문단 찾기. 실제 편집기처럼 본문 문단에 이야기를 적거나 본문 밖 문단에 이야기를 빠뜨리거나 틀리게 적으면 오류를 낸다. */
  private para(blockId: string, story?: Story): ParaSpec {
    if (this.textBoxIds.has(blockId)) throw new Error(`Block "${blockId}" not found.`);
    const inBody = this.paras.find((x) => x.paraId === blockId);
    if (inBody) {
      if (story) throw new Error(`블록 ${blockId} 은 본문에 있는데 이야기가 ${storyKey(story)} 로 적혔어요`);
      return inBody;
    }
    for (const s of this.stories) {
      const hit = s.flat.find((x) => x.paraId === blockId);
      if (!hit) continue;
      if (!story || storyKey(story) !== storyKey(s.story)) throw new Error(`블록 ${blockId} 의 이야기가 맞지 않아요(${story ? storyKey(story) : '본문'})`);
      return hit;
    }
    throw new Error(`블록 ${blockId} 이 없어요`);
  }

  private checkAreaApi(): void {
    if (this.areaApiBroken) throw new Error('이 편집기 판은 머리말·각주를 읽는 기능이 없어요');
  }

  host: DocxHost = {
    doc: {
      extract: async () => {
        this.extractCount++;
        return { blocks: this.paras.map((p) => ({ nodeId: p.paraId as string, type: 'paragraph', text: shownText(p) })), revision: String(this.rev) };
      },
      replace: async (input: unknown) => {
        const { target, text } = input as { target: { start: { blockId: string; offset: number }; end: { offset: number }; story?: Story }; text: string };
        const p = this.para(target.start.blockId, target.story);
        if (!this.ignore.has('replace')) {
          p.text = p.text.slice(0, target.start.offset) + (this.mangleReplace ? `${text}!` : text) + p.text.slice(target.end.offset);
          this.rev++;
        }
        return { success: true };
      },
      format: {
        apply: async (input: unknown) => {
          const { target, inline } = input as { target: { start: { blockId: string }; story?: Story }; inline: Record<string, unknown> };
          const p = this.para(target.start.blockId, target.story);
          if (!this.ignore.has('format')) {
            if (inline.rFonts) {
              // 실제 SuperDoc 처럼 글꼴 칸 전체를 통째로 바꾼다(null 인 칸은 지워진다).
              p.rFonts = Object.fromEntries(Object.entries(inline.rFonts as Record<string, string | null>).filter(([, v]) => v)) as ParaSpec['rFonts'];
              delete p.font;
            }
            if (inline.fontSize !== undefined) p.sizePt = inline.fontSize as number;
            if (inline.bold !== undefined) p.bold = inline.bold as boolean;
            this.rev++;
          }
          return { success: true };
        },
      },
      paragraphs: {
        setAlignment: async (input: unknown) => {
          const { target, alignment } = input as { target: { nodeId: string; story?: Story }; alignment: 'left' | 'center' | 'right' | 'justify' };
          const p = this.para(target.nodeId, target.story);
          if (!this.ignore.has('align')) {
            p.align = alignment === 'justify' ? 'both' : alignment;
            this.rev++;
          }
          return { success: true };
        },
        setSpacing: async (input: unknown) => {
          const { target, line } = input as { target: { nodeId: string; story?: Story }; line: number };
          const p = this.para(target.nodeId, target.story);
          if (!this.ignore.has('spacing')) {
            p.linePct = Math.round(line / 2.4);
            this.rev++;
          }
          return { success: true };
        },
      },

      // ---- 본문 밖의 글 ----
      blocks: {
        list: async (input) => {
          this.checkAreaApi();
          const s = this.find(input.in);
          const entries = (s?.items ?? []).map((it, i) =>
            Array.isArray(it)
              ? { nodeId: `tbl:${i}`, nodeType: 'table', text: flatten([it]).map(shownText).join('') }
              : { nodeId: it.paraId as string, nodeType: 'paragraph', text: shownText(it) },
          );
          const from = input.offset ?? 0;
          return { total: entries.length, blocks: entries.slice(from, from + this.pageSize) };
        },
      },
      find: async (input) => {
        this.checkAreaApi();
        const s = this.find(input.in);
        const all = (s?.flat ?? []).map((p) => ({ address: { kind: 'block', nodeType: 'paragraph', nodeId: p.paraId as string, story: s?.story } }));
        const from = input.offset ?? 0;
        return { total: all.length, items: all.slice(from, from + this.pageSize) };
      },
      getNode: async (address: unknown) => {
        this.checkAreaApi();
        const a = address as { nodeId: string; story?: Story };
        const p = this.para(a.nodeId, a.story);
        const inlines: Array<{ kind: string; run?: { text: string } }> = [{ kind: 'run', run: { text: p.text } }];
        if (p.noteRef) inlines.push({ kind: p.noteRef.kind === 'footnote' ? 'footnoteReference' : 'endnoteReference' });
        return { node: { paragraph: { inlines } } };
      },
      headerFooters: {
        list: async (input) => {
          this.checkAreaApi();
          const place = placeHeadersFooters(this.areas);
          const items = (['header', 'footer'] as const).flatMap((kind) =>
            (['default', 'first', 'even'] as const).map((variant) => ({ sectionIndex: 0, kind, variant, refId: place.find((p) => p.kind === kind && p.type === variant)?.refId ?? null })),
          );
          const from = input?.offset ?? 0;
          return { total: items.length, items: items.slice(from, from + this.pageSize) };
        },
        parts: {
          list: async (input) => {
            this.checkAreaApi();
            const items = placeHeadersFooters(this.areas).map((p) => ({ refId: p.refId, kind: p.kind, partPath: p.part }));
            const from = input?.offset ?? 0;
            return { total: items.length, items: items.slice(from, from + this.pageSize) };
          },
        },
      },
      footnotes: {
        list: async (input) => {
          this.checkAreaApi();
          this.areaReadCount++;
          const notes = (input.type === 'footnote' ? this.areas.footnotes : this.areas.endnotes) ?? [];
          const items = notes.map((_, i) => ({ noteId: String(i + 1), displayNumber: String(i + 1) }));
          const from = input.offset ?? 0;
          return { total: items.length, items: items.slice(from, from + this.pageSize) };
        },
      },
    },
    exportDocx: async () => {
      this.exportCount++;
      const strip = (p: ParaSpec): ParaSpec => (this.exportParaIds ? p : { ...p, paraId: undefined, ...(p.textBox ? { textBox: strip(p.textBox) } : {}) });
      const areas: DocxAreas = { ...(this.areas.evenAndOdd ? { evenAndOdd: true } : {}) };
      for (const key of ['header', 'firstHeader', 'evenHeader', 'footer', 'firstFooter', 'evenFooter'] as const) {
        if (this.areas[key]) areas[key] = mapParas(this.areas[key], strip);
      }
      if (this.areas.footnotes) areas.footnotes = this.areas.footnotes.map((paras) => paras.map(strip));
      if (this.areas.endnotes) areas.endnotes = this.areas.endnotes.map((paras) => paras.map(strip));
      return new Blob([new Uint8Array(makeDocxBytes(mapParas(this.items, strip), areas))]);
    },
  };
}
