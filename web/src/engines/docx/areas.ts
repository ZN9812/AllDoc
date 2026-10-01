// DOCX 의 머리말·꼬리말·각주·미주·글상자(본문 밖의 글) 읽기.
// SuperDoc 의 문서 API 는 본문 말고도 "이야기(story)" 단위로 글을 읽고 고칠 수 있다(blocks.list·find·getNode·replace·format 의 story 인자).
// 본문을 읽는 extract() 는 이야기를 받지 않으므로, 머리말·꼬리말·각주·미주는 이야기마다 따로 읽는다.
// 글상자 안의 문단은 extract() 의 목록에도 (글상자를 단 문단 바로 다음에) 나오므로, 따로 덧붙이지 않고 그 블록에 자리를 붙인다(readTextBoxes).
import type { AreaPlace } from '@alldoc/shared';
import type { BlockLike } from './model';

/** SuperDoc 문서 API 가 가리키는 본문 밖의 이야기 */
export type Story =
  | { kind: 'story'; storyType: 'headerFooterPart'; refId: string }
  | { kind: 'story'; storyType: 'footnote'; noteId: string }
  | { kind: 'story'; storyType: 'endnote'; noteId: string }
  | { kind: 'story'; storyType: 'textbox'; textboxId: string };

export type AreaKind = 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox';
export type HfVariant = 'default' | 'first' | 'even';

/** 문단이 든 본문 밖의 자리 */
export interface AreaRef {
  story: Story;
  kind: AreaKind;
  /** 내보낸 DOCX 에서 이 글이 든 파일(예: word/header1.xml. 글상자는 본문 파일 word/document.xml). 글자·문단 서식은 이 파일에서 읽는다. */
  part: string;
  /** 머리말·꼬리말이 쓰이는 자리 */
  variant?: HfVariant;
  /** 구역 번호(1부터). 같은 종류의 머리말·꼬리말이 구역마다 다를 때만 */
  section?: number;
  /** 각주·미주·글상자 번호(1부터) */
  number?: number;
}

/** SuperDoc 문서 API 중 이 모듈이 쓰는 부분. 없으면(다른 판의 편집기) 머리말·각주를 건너뛰고 본문만 다룬다. */
export interface AreaApi {
  blocks?: {
    list(input: { in: Story; includeText: true; offset?: number }): Promise<{ total: number; blocks: Array<{ nodeId: string; nodeType: string; text?: string | null }> }>;
  };
  find?(input: { select: { type: 'node'; nodeType: 'paragraph' }; in: Story; offset?: number }): Promise<{ total: number; items: Array<{ address?: { nodeId?: string } }> }>;
  getNode?(address: unknown): Promise<{ node?: { paragraph?: { inlines?: Array<{ kind: string; run?: { text?: string } }> } } }>;
  headerFooters?: {
    list(input?: { offset?: number }): Promise<{ total: number; items: Array<{ sectionIndex: number; kind: 'header' | 'footer'; variant: HfVariant; refId: string | null }> }>;
    parts: { list(input?: { offset?: number }): Promise<{ total: number; items: Array<{ refId: string; kind: 'header' | 'footer'; partPath: string }> }> };
  };
  footnotes?: {
    list(input: { type: 'footnote' | 'endnote'; offset?: number }): Promise<{ total: number; items: Array<{ noteId: string; displayNumber?: string }> }>;
  };
}

/** AI 와 화면이 한꺼번에 다루는 본문 밖 문단의 수 상한. 넘는 문단은 읽지 않는다(아주 큰 문서에서 읽기가 오래 걸리지 않게). */
export const MAX_AREA_PARAGRAPHS = 500;

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'listItem']);
const NOTE_PART = { footnote: 'word/footnotes.xml', endnote: 'word/endnotes.xml' } as const;
/** 본문(과 그 안의 글상자)이 든 파일 */
export const BODY_PART = 'word/document.xml';
const VARIANT_ORDER: Record<HfVariant, number> = { default: 0, first: 1, even: 2 };

/** 목록 API 는 한 번에 일부만 줄 수 있어, 다 받을 때까지 이어서 읽는다. */
async function allPages<T>(read: (offset: number) => Promise<{ total: number; items: T[] }>): Promise<T[]> {
  const out: T[] = [];
  for (let round = 0; round < 100; round++) {
    const r = await read(out.length);
    out.push(...r.items);
    if (r.items.length === 0 || out.length >= r.total) break;
  }
  return out;
}

interface StoryPara {
  nodeId: string;
  type: string;
  text: string;
}

/** 표 칸 안의 문단 글. 편집기가 최상위 문단만 글을 주므로 문단 하나씩 읽는다. 글이 아닌 것(각주 표시, 줄바꿈, 탭 …)이 끼어 있으면 글자 위치가 어긋날 수 있어 읽지 않는다. */
async function nestedText(api: AreaApi, story: Story, nodeId: string): Promise<string | null> {
  try {
    const r = await api.getNode?.({ kind: 'block', nodeType: 'paragraph', nodeId, story });
    const inlines = r?.node?.paragraph?.inlines;
    if (!inlines || inlines.some((i) => i.kind !== 'run' || typeof i.run?.text !== 'string' || /[\u0000-\u001F\uFFFC]/u.test(i.run.text))) return null;
    return inlines.map((i) => i.run?.text ?? '').join('');
  } catch {
    return null;
  }
}

/** 이야기 하나의 문단들을 문서 순서대로 읽는다. unreadable 은 읽을 수 없어 건너뛴 문단 수. */
async function readStory(api: AreaApi, story: Story): Promise<{ paras: StoryPara[]; unreadable: number }> {
  const blocksApi = api.blocks;
  if (!blocksApi) return { paras: [], unreadable: 0 };
  const top = await allPages(async (offset) => {
    const r = await blocksApi.list({ in: story, includeText: true, offset });
    return { total: r.total, items: r.blocks };
  });
  const own = top.filter((b) => TEXT_BLOCKS.has(b.nodeType)).map((b) => ({ nodeId: b.nodeId, type: b.nodeType, text: b.text ?? '' }));

  // 표나 콘텐츠 컨트롤이 든 이야기(예: 표로 짠 머리말)는 칸 안의 문단이 최상위 목록에 없다. find 로 문단을 문서 순서대로 얻어 채운다.
  const nested = top.some((b) => b.nodeType === 'table' || b.nodeType === 'sdt');
  if (!nested || !api.find) return { paras: own, unreadable: 0 };
  let ids: string[];
  try {
    const items = await allPages(async (offset) => {
      const r = await (api.find as NonNullable<AreaApi['find']>)({ select: { type: 'node', nodeType: 'paragraph' }, in: story, offset });
      return { total: r.total, items: r.items };
    });
    ids = items.map((i) => i.address?.nodeId).filter((id): id is string => typeof id === 'string');
  } catch {
    return { paras: own, unreadable: 0 };
  }
  const byId = new Map(own.map((p) => [p.nodeId, p]));
  const seen = new Set<string>();
  const paras: StoryPara[] = [];
  let unreadable = 0;
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const known = byId.get(id);
    if (known) {
      paras.push(known);
      continue;
    }
    const text = await nestedText(api, story, id);
    if (text === null) unreadable++;
    else paras.push({ nodeId: id, type: 'paragraph', text });
  }
  // 제목·목록 항목은 문단 찾기에 안 나올 수 있다. 빠뜨리지 않게 끝에 붙인다.
  for (const p of own) if (!seen.has(p.nodeId)) paras.push(p);
  return { paras, unreadable };
}

/** 읽을 이야기들: 머리말(구역·쪽 순) → 꼬리말 → 각주 → 미주 */
async function listTargets(api: AreaApi): Promise<AreaRef[]> {
  const targets: AreaRef[] = [];
  const hf = api.headerFooters;
  if (hf) {
    const slots = await allPages(async (offset) => {
      const r = await hf.list({ offset });
      return { total: r.total, items: r.items };
    });
    const parts = await allPages(async (offset) => {
      const r = await hf.parts.list({ offset });
      return { total: r.total, items: r.items };
    });
    const sectionCount = slots.reduce((n, s) => Math.max(n, s.sectionIndex + 1), 0);
    // 어느 구역도 쓰지 않는 부분(파일에만 남은 옛 머리말)은 어느 쪽에도 나오지 않으니 읽지 않는다.
    const info = parts.flatMap((part) => {
      const first = slots.filter((s) => s.refId === part.refId).sort((a, b) => a.sectionIndex - b.sectionIndex || VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant])[0];
      return first ? [{ part, variant: first.variant, sectionIndex: first.sectionIndex }] : [];
    });
    info.sort((a, b) => (a.part.kind === b.part.kind ? 0 : a.part.kind === 'header' ? -1 : 1) || a.sectionIndex - b.sectionIndex || VARIANT_ORDER[a.variant] - VARIANT_ORDER[b.variant]);
    for (const { part, variant, sectionIndex } of info) {
      // 구역 번호는 같은 종류·자리의 머리말·꼬리말이 구역마다 따로 있을 때만 붙인다(하나뿐이면 문서 전체에 쓰이는 것이다).
      const siblings = info.filter((o) => o.part.kind === part.kind && o.variant === variant).length;
      const ref: AreaRef = { story: { kind: 'story', storyType: 'headerFooterPart', refId: part.refId }, kind: part.kind, part: part.partPath, variant };
      if (sectionCount > 1 && siblings > 1) ref.section = sectionIndex + 1;
      targets.push(ref);
    }
  }
  const fn = api.footnotes;
  if (fn) {
    for (const type of ['footnote', 'endnote'] as const) {
      const notes = await allPages(async (offset) => {
        const r = await fn.list({ type, offset });
        return { total: r.total, items: r.items };
      });
      notes.forEach((n, i) => {
        const shown = Number(n.displayNumber);
        const number = Number.isInteger(shown) && shown >= 1 ? shown : i + 1;
        targets.push({ story: { kind: 'story', storyType: type, noteId: n.noteId }, kind: type, part: NOTE_PART[type], number });
      });
    }
  }
  return targets;
}

export interface AreaRead {
  blocks: BlockLike[];
  /** 읽을 수 없어 건너뛴 문단 수(표 칸 안에 글이 아닌 것이 끼어 있는 경우 등) */
  unreadable: number;
  /** 상한(MAX_AREA_PARAGRAPHS)을 넘어 읽지 않은 문단 수 */
  skipped: number;
}

/**
 * 문서의 머리말·꼬리말·각주·미주 문단을 모두 읽는다. 순서는 문서 상태만으로 정해진다(머리말 → 꼬리말 → 각주 → 미주).
 * 읽는 도중 편집기가 오류를 내면 본문만 다루도록 빈 결과를 돌려준다(일부만 읽으면 문단 번호가 읽을 때마다 달라진다).
 */
export async function readAreas(api: AreaApi): Promise<AreaRead> {
  const empty: AreaRead = { blocks: [], unreadable: 0, skipped: 0 };
  try {
    const blocks: BlockLike[] = [];
    let unreadable = 0;
    let skipped = 0;
    for (const ref of await listTargets(api)) {
      const read = await readStory(api, ref.story);
      unreadable += read.unreadable;
      for (const p of read.paras) {
        if (blocks.length >= MAX_AREA_PARAGRAPHS) skipped++;
        else blocks.push({ nodeId: p.nodeId, type: p.type, text: p.text, area: ref });
      }
    }
    return { blocks, unreadable, skipped };
  } catch (e) {
    console.warn('[Word 편집기] 머리말·꼬리말·각주를 읽지 못해 본문만 다뤄요', e);
    return empty;
  }
}

/** 글상자 번호(tb0, tb1 …)를 찾아보는 가장 큰 번호 수와, 비어 있는 번호가 이어지면 그만 찾는 개수 */
const MAX_TEXT_BOX_IDS = 300;
const MAX_EMPTY_IDS = 3;

export interface TextBoxRead {
  /** 글상자 안의 문단 번호(nodeId) → 글상자 자리 */
  boxes: Map<string, AreaRef>;
  /**
   * 읽다가 오류가 난 번호 수. 편집기는 없는 번호를 오류로 알리지 않고 빈 목록으로 알리므로(실제 SuperDoc 에서 확인),
   * 0 이 아니면 일시적인 문제일 수 있다. 호출한 쪽이 그런 결과를 간직하지 않게 알려 준다.
   */
  errors: number;
}

/**
 * 본문에 놓인 글상자 안의 문단을 찾아 "문단 번호(nodeId) → 자리"로 돌려준다. bodyIds 는 본문을 읽는 extract() 가 돌려준 문단 번호들이다.
 * 글상자 안의 문단은 그 목록에도 나오므로(글상자를 단 문단 바로 다음), 호출한 쪽이 그 블록에 이 자리를 붙여 쓴다. 번호(= 문단 번호)가 바뀌지 않는다.
 *
 * 글상자 번호(tb0, tb1 …)는 문서에 나오는 순서이지만 중간이 비어 있을 수 있다. Word·LibreOffice 는 글상자를 그림 방식(DrawingML)과
 * 옛 방식(VML) 두 벌로 저장하고(mc:AlternateContent), 편집기는 그 안의 옛 방식 복사본(mc:Fallback)을 받아들이지 않아서 그 번호의 글상자는 비어 있다(실제로 tb0 tb2 tb4 … 로 나왔다).
 * 옛 방식 글상자만 단독으로 저장된 문서의 글상자는 받아들인다(실제 편집기에서 읽고 고치는 것을 확인했다).
 * 그래서 빈 번호를 몇 개 건너뛰며 찾고, 화면에 보이는 글상자 번호는 찾은 순서(1부터)로 센다.
 * 글상자가 하나도 없는 문서는 빈 번호만 몇 번 찾아보고 끝난다. 읽는 도중 오류가 나면 그 번호는 없는 것으로 치고 errors 로 알린다.
 * 번호를 하나씩 읽어 보므로 글상자가 많은 문서는 느리다(100개 문서에서 약 5초).
 */
export async function readTextBoxes(api: AreaApi, bodyIds: ReadonlySet<string>): Promise<TextBoxRead> {
  const boxes = new Map<string, AreaRef>();
  let errors = 0;
  if (!api.blocks) return { boxes, errors };
  let number = 0;
  let empty = 0;
  for (let i = 0; i < MAX_TEXT_BOX_IDS && empty < MAX_EMPTY_IDS; i++) {
    const story: Story = { kind: 'story', storyType: 'textbox', textboxId: `tb${i}` };
    let paras: StoryPara[] = [];
    try {
      paras = (await readStory(api, story)).paras.filter((p) => bodyIds.has(p.nodeId));
    } catch {
      errors++;
      paras = [];
    }
    if (paras.length === 0) {
      empty++;
      continue;
    }
    empty = 0;
    number++;
    for (const p of paras) boxes.set(p.nodeId, { story, kind: 'textbox', part: BODY_PART, number });
  }
  return { boxes, errors };
}

/**
 * 사람에게 보여 줄 위치. evenOdd: 문서가 홀수·짝수 쪽 머리말을 따로 쓰는가(그러면 기본 머리말은 홀수 쪽용이다).
 * noteOrder: 본문에서 각주·미주 표시가 나오는 순서(w:id). 있으면 각주·미주 번호를 그 순서로 센다 —
 * 편집기가 알려 주는 번호는 파일 안의 번호(w:id)를 따라가서, LibreOffice 처럼 번호가 2부터 시작하는 파일에서는 화면에 보이는 번호와 다르다.
 */
export function toPlace(a: AreaRef, evenOdd: boolean, noteOrder?: { footnote: string[]; endnote: string[] }): AreaPlace {
  if (a.kind === 'header' || a.kind === 'footer') {
    const pages = a.variant === 'first' ? 'first' : a.variant === 'even' ? 'even' : evenOdd ? 'odd' : 'both';
    return { kind: a.kind, pages, ...(a.section !== undefined ? { section: a.section } : {}) };
  }
  if (a.kind === 'textbox') return { kind: 'textbox', ...(a.number !== undefined ? { number: a.number } : {}) };
  const noteId = a.story.storyType === 'footnote' || a.story.storyType === 'endnote' ? a.story.noteId : '';
  const rank = noteOrder ? noteOrder[a.kind === 'endnote' ? 'endnote' : 'footnote'].indexOf(noteId) : -1;
  const number = rank >= 0 ? rank + 1 : a.number;
  return { kind: a.kind, ...(number !== undefined ? { number } : {}) };
}
