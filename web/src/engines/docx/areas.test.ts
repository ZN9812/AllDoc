import { textGuard, type Op } from '@alldoc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeConsistency } from '../../ai/consistency';
import { MAX_AREA_PARAGRAPHS, readAreas, toPlace, type AreaApi } from './areas';
import { shownText, type DocxAreas, type ParaSpec } from './fixtures';
import { DocxModel } from './model';
import { FakeDocx } from './testing';

afterEach(() => vi.restoreAllMocks());

const FONT = { font: '맑은 고딕' } as const;
const BODY: ParaSpec[] = [
  { text: '본문 제목', ...FONT, sizePt: 18, bold: true, align: 'center' },
  { text: '본문 첫 문단입니다.', ...FONT, sizePt: 10, noteRef: { kind: 'footnote', id: 1 } },
  { text: '둘째 문단에 미주가 있습니다.', ...FONT, sizePt: 10, noteRef: { kind: 'endnote', id: 1 } },
];
/** 본문 3개(0~2) 뒤에 머리말(3·4) → 첫 쪽 머리말(5) → 꼬리말(6) → 각주 1(7·8) → 각주 2(9) → 미주 1(10) */
const AREAS: DocxAreas = {
  header: [{ text: '머리말 첫째 줄: 몇일 뒤', sizePt: 12, bold: true, align: 'center' }, { text: '머리말 둘째 줄' }],
  firstHeader: [{ text: '첫 쪽 머리말입니다' }],
  footer: [{ text: '꼬리말 할려고 했어요 - ', align: 'right', pageField: true }],
  footnotes: [[{ text: ' 각주 글: 몇일 걸립니다.' }, { text: '각주의 둘째 문단' }], [{ text: ' 두 번째 각주', bold: true, align: 'right' }]],
  endnotes: [[{ text: ' 미주 글입니다.' }]],
};
const make = (areas: DocxAreas = AREAS, body: ParaSpec[] = BODY): FakeDocx => new FakeDocx(body, areas);
const model = (f: FakeDocx): DocxModel => new DocxModel(f.host);
/** 문단 번호(index)의 지문. 편집기가 보여 주는 글(쪽 번호 필드의 결과와 각주 표시 자리 포함)로 만든다. */
const guardAt = (f: FakeDocx, index: number): string => {
  const all = [...f.paras, ...f.areaParas];
  return textGuard(shownText(all[index] as ParaSpec));
};
const areaTexts = (f: FakeDocx): string[] => f.areaParas.map((p) => p.text);
const fix = (f: FakeDocx, index: number, find: string, replace: string): Op => ({ type: 'replaceText', paragraph: index, find, replace, guard: guardAt(f, index) });

describe('toPlace: 머리말·꼬리말이 쓰이는 쪽과 각주 번호를 사람이 읽을 위치로', () => {
  it('기본 머리말은 양쪽, 홀수·짝수를 따로 쓰는 문서에서는 홀수 쪽이고, 첫 쪽·짝수 쪽은 그대로다', () => {
    const ref = (variant: 'default' | 'first' | 'even', section?: number) => ({ story: { kind: 'story' as const, storyType: 'headerFooterPart' as const, refId: 'r' }, kind: 'header' as const, part: 'word/header1.xml', variant, ...(section ? { section } : {}) });
    expect(toPlace(ref('default'), false)).toEqual({ kind: 'header', pages: 'both' });
    expect(toPlace(ref('default'), true)).toEqual({ kind: 'header', pages: 'odd' });
    expect(toPlace(ref('first'), true)).toEqual({ kind: 'header', pages: 'first' });
    expect(toPlace(ref('even'), false)).toEqual({ kind: 'header', pages: 'even' });
    expect(toPlace(ref('default', 2), false)).toEqual({ kind: 'header', pages: 'both', section: 2 });
  });

  it('각주·미주 번호는 본문에서 표시가 나온 순서가 있으면 그 순서로, 없으면 편집기가 알려 준 번호로 센다', () => {
    const note = (kind: 'footnote' | 'endnote', noteId: string, number?: number) => ({ story: { kind: 'story' as const, storyType: kind, noteId }, kind, part: 'word/footnotes.xml', ...(number ? { number } : {}) });
    const order = { footnote: ['5', '3'], endnote: ['9'] };
    expect(toPlace(note('footnote', '3', 3), false, order)).toEqual({ kind: 'footnote', number: 2 });
    expect(toPlace(note('footnote', '5', 5), false, order)).toEqual({ kind: 'footnote', number: 1 });
    expect(toPlace(note('endnote', '9', 9), false, order)).toEqual({ kind: 'endnote', number: 1 });
    expect(toPlace(note('footnote', '7', 4), false, order)).toEqual({ kind: 'footnote', number: 4 });
    expect(toPlace(note('footnote', '7'), false)).toEqual({ kind: 'footnote' });
  });
});

describe('readAreas: 편집기 문서 API 로 본문 밖의 글 읽기', () => {
  it('머리말 → 꼬리말 → 각주 → 미주 순서로, 문단마다 자리와 파일을 붙여 읽는다', async () => {
    const f = make();
    const r = await readAreas(f.host.doc);
    expect(r.unreadable).toBe(0);
    expect(r.blocks.map((b) => [b.text, b.area?.kind, b.area?.variant, b.area?.number, b.area?.part])).toEqual([
      ['머리말 첫째 줄: 몇일 뒤', 'header', 'default', undefined, 'word/header1.xml'],
      ['머리말 둘째 줄', 'header', 'default', undefined, 'word/header1.xml'],
      ['첫 쪽 머리말입니다', 'header', 'first', undefined, 'word/header2.xml'],
      ['꼬리말 할려고 했어요 - 1', 'footer', 'default', undefined, 'word/footer1.xml'],
      [' 각주 글: 몇일 걸립니다.', 'footnote', undefined, 1, 'word/footnotes.xml'],
      ['각주의 둘째 문단', 'footnote', undefined, 1, 'word/footnotes.xml'],
      [' 두 번째 각주', 'footnote', undefined, 2, 'word/footnotes.xml'],
      [' 미주 글입니다.', 'endnote', undefined, 1, 'word/endnotes.xml'],
    ]);
  });

  it('목록 API 가 한 번에 일부만 줘도 이어서 끝까지 읽는다', async () => {
    const f = make({ ...AREAS, footnotes: Array.from({ length: 7 }, (_, i) => [{ text: ` 각주 ${i + 1}` }]) });
    f.pageSize = 2;
    const r = await readAreas(f.host.doc);
    expect(r.blocks.filter((b) => b.area?.kind === 'footnote').map((b) => b.text)).toEqual(Array.from({ length: 7 }, (_, i) => ` 각주 ${i + 1}`));
    expect(r.blocks.filter((b) => b.area?.kind === 'header')).toHaveLength(3);
  });

  it('머리말 안의 표 칸 문단도 문서 순서대로 읽고, 칸 안에 글이 아닌 것(각주 표시)이 끼어 있으면 건너뛰며 센다', async () => {
    const f = make({
      header: [[[{ text: '왼쪽 칸 몇일' }, { text: '오른쪽 칸', noteRef: { kind: 'footnote', id: 1 } }]], { text: '표 아래 줄' }],
    });
    const r = await readAreas(f.host.doc);
    expect(r.blocks.map((b) => b.text)).toEqual(['왼쪽 칸 몇일', '표 아래 줄']);
    expect(r.unreadable).toBe(1);
  });

  it('어느 구역도 쓰지 않는 머리말 부분은 읽지 않는다', async () => {
    const api: AreaApi = {
      blocks: { list: async () => ({ total: 1, blocks: [{ nodeId: 'a', nodeType: 'paragraph', text: '글' }] }) },
      headerFooters: {
        list: async () => ({ total: 1, items: [{ sectionIndex: 0, kind: 'header', variant: 'default', refId: 'rId1' }] }),
        parts: {
          list: async () => ({
            total: 2,
            items: [
              { refId: 'rId1', kind: 'header', partPath: 'word/header1.xml' },
              { refId: 'rId9', kind: 'header', partPath: 'word/header9.xml' },
            ],
          }),
        },
      },
    };
    const r = await readAreas(api);
    expect(r.blocks.map((b) => b.area?.part)).toEqual(['word/header1.xml']);
  });

  it('구역마다 다른 머리말이면 구역 번호를 붙이고, 문서 전체에 하나뿐인 꼬리말에는 붙이지 않는다', async () => {
    const api: AreaApi = {
      blocks: { list: async ({ in: story }) => ({ total: 1, blocks: [{ nodeId: `n-${story.storyType === 'headerFooterPart' ? story.refId : ''}`, nodeType: 'paragraph', text: '글' }] }) },
      headerFooters: {
        list: async () => ({
          total: 3,
          items: [
            { sectionIndex: 0, kind: 'header', variant: 'default', refId: 'h1' },
            { sectionIndex: 1, kind: 'header', variant: 'default', refId: 'h2' },
            { sectionIndex: 0, kind: 'footer', variant: 'default', refId: 'f1' },
          ],
        }),
        parts: {
          list: async () => ({
            total: 3,
            items: [
              { refId: 'f1', kind: 'footer', partPath: 'word/footer1.xml' },
              { refId: 'h2', kind: 'header', partPath: 'word/header2.xml' },
              { refId: 'h1', kind: 'header', partPath: 'word/header1.xml' },
            ],
          }),
        },
      },
    };
    const r = await readAreas(api);
    expect(r.blocks.map((b) => [b.area?.kind, b.area?.section])).toEqual([
      ['header', 1],
      ['header', 2],
      ['footer', undefined],
    ]);
  });

  it('읽는 문단 수에 상한이 있고 넘으면 건너뛴 수를 알려 준다', async () => {
    const f = make({ footnotes: Array.from({ length: MAX_AREA_PARAGRAPHS + 3 }, (_, i) => [{ text: ` 각주 ${i + 1}` }]) });
    const r = await readAreas(f.host.doc);
    expect(r.blocks).toHaveLength(MAX_AREA_PARAGRAPHS);
    expect(r.skipped).toBe(3);
  });

  it('편집기가 오류를 내거나 기능이 없으면 본문만 다루도록 빈 결과를 돌려준다', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = make();
    broken.areaApiBroken = true;
    expect(await readAreas(broken.host.doc)).toEqual({ blocks: [], unreadable: 0, skipped: 0 });
    expect(warn).toHaveBeenCalledOnce();
    expect(await readAreas({})).toEqual({ blocks: [], unreadable: 0, skipped: 0 });
  });
});

describe('DocxModel.summarize: 머리말·꼬리말·각주·미주', () => {
  it('본문 문단 번호는 그대로이고, 본문 밖 문단이 그 뒤에 이어지며 위치(area)가 붙는다', async () => {
    const s = await model(make()).summarize();
    expect(s.paragraphs.map((p) => [p.index, p.text, p.area ?? null])).toEqual([
      [0, '본문 제목', null],
      [1, '본문 첫 문단입니다.￼', null],
      [2, '둘째 문단에 미주가 있습니다.￼', null],
      [3, '머리말 첫째 줄: 몇일 뒤', { kind: 'header', pages: 'both' }],
      [4, '머리말 둘째 줄', { kind: 'header', pages: 'both' }],
      [5, '첫 쪽 머리말입니다', { kind: 'header', pages: 'first' }],
      [6, '꼬리말 할려고 했어요 - 1', { kind: 'footer', pages: 'both' }],
      [7, ' 각주 글: 몇일 걸립니다.', { kind: 'footnote', number: 1 }],
      [8, '각주의 둘째 문단', { kind: 'footnote', number: 1 }],
      [9, ' 두 번째 각주', { kind: 'footnote', number: 2 }],
      [10, ' 미주 글입니다.', { kind: 'endnote', number: 1 }],
    ]);
  });

  it('본문 밖 문단의 글꼴·크기·굵기·정렬은 그 글이 든 파일에서 읽는다(스타일 상속 포함)', async () => {
    const s = await model(make()).summarize();
    const at = (i: number) => s.paragraphs.find((p) => p.index === i);
    expect(at(3)).toMatchObject({ char: { fontSizePt: 12, bold: true }, para: { align: 'center' } });
    expect(at(6)?.para.align).toBe('right');
    // 각주 문단은 각주 글 스타일(9pt)을 물려받고, 각주 번호 표시 줄(앞의 번호 칸)이 크기를 정하지 않는다.
    expect(at(7)?.char.fontSizePt).toBe(9);
    expect(at(9)).toMatchObject({ char: { fontSizePt: 9, bold: true }, para: { align: 'right' } });
  });

  it('각주 번호는 본문에서 표시가 나오는 순서로 센다(파일 안의 번호와 다를 수 있다). 본문에 표시가 없는 각주는 편집기가 알려 준 번호를 쓴다', async () => {
    const f = make(
      { footnotes: [[{ text: ' 먼저 만든 각주' }], [{ text: ' 나중에 만든 각주' }], [{ text: ' 표시 없는 각주' }]] },
      [{ text: '앞 문단', noteRef: { kind: 'footnote', id: 2 } }, { text: '뒤 문단', noteRef: { kind: 'footnote', id: 1 } }],
    );
    const s = await model(f).summarize();
    expect(s.paragraphs.filter((p) => p.area).map((p) => [p.text, p.area?.number])).toEqual([
      [' 먼저 만든 각주', 2],
      [' 나중에 만든 각주', 1],
      [' 표시 없는 각주', 3],
    ]);
  });

  it('홀수·짝수 쪽 머리말을 따로 쓰는 문서는 기본 머리말이 홀수 쪽으로 보인다', async () => {
    const f = make({ header: [{ text: '홀수 쪽 머리말' }], evenHeader: [{ text: '짝수 쪽 머리말' }], evenAndOdd: true });
    const s = await model(f).summarize();
    expect(s.paragraphs.filter((p) => p.area).map((p) => p.area?.pages)).toEqual(['odd', 'even']);
  });

  it('머리말 안의 표 칸 문단에는 표 위치(cell)가 아니라 머리말 위치만 붙는다', async () => {
    const f = make({ header: [[[{ text: '왼쪽 칸' }, { text: '오른쪽 칸' }]], { text: '표 아래 줄' }] });
    const s = await model(f).summarize();
    const inHeader = s.paragraphs.filter((p) => p.index >= 3);
    expect(inHeader.map((p) => p.text)).toEqual(['왼쪽 칸', '오른쪽 칸', '표 아래 줄']);
    expect(inHeader.every((p) => p.area?.kind === 'header' && p.cell === undefined)).toBe(true);
  });

  it('글이 없는 머리말·꼬리말은 문단 목록에 넣지 않지만 번호 순서는 유지한다', async () => {
    const f = make({ header: [{ text: '   ' }], footer: [{ text: '꼬리말' }] });
    const s = await model(f).summarize();
    expect(s.paragraphs.filter((p) => p.index >= 3).map((p) => [p.index, p.text])).toEqual([[4, '꼬리말']]);
  });

  it('문단 번호(w14:paraId)가 없는 문서에서도 본문의 각주 표시가 든 문단을 글로 짝지어 서식을 읽는다', async () => {
    const f = make();
    f.exportParaIds = false;
    const s = await model(f).summarize();
    expect(s.paragraphs[1]).toMatchObject({ char: { fontSizePt: 10 } });
    // 본문 밖 문단은 문단 번호로만 짝지으므로 서식을 알 수 없다(서식을 바꾸는 변경은 거절된다).
    expect(s.paragraphs[3]).toMatchObject({ char: {}, area: { kind: 'header' } });
  });

  it('문서가 바뀌지 않았으면 본문 밖의 글과 서식을 다시 읽지 않는다', async () => {
    const f = make();
    const m = model(f);
    await m.summarize();
    await m.summarize();
    expect(f.exportCount).toBe(1);
    expect(f.areaReadCount).toBe(2); // 각주·미주 목록을 한 번씩 읽은 것
    f.rev++;
    await m.summarize();
    expect(f.exportCount).toBe(2);
  });

  it('서식 점검(문서 안 일관성)은 머리말·꼬리말·각주를 본문과 비교하지 않는다', async () => {
    const f = make(AREAS, [
      { text: '본문 첫째 문장입니다.', ...FONT, sizePt: 10 },
      { text: '본문 둘째 문장입니다.', ...FONT, sizePt: 10 },
      { text: '본문 셋째 문장입니다.', ...FONT, sizePt: 10 },
    ]);
    const s = await model(f).summarize();
    expect(s.paragraphs.some((p) => p.area && p.char.fontSizePt !== 10)).toBe(true); // 본문과 크기가 다른 머리말·각주가 있다.
    expect(analyzeConsistency(s).findings).toEqual([]);
  });

  it('머리말·각주를 읽는 기능이 없는 편집기에서도 본문은 그대로 다룬다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = make();
    f.areaApiBroken = true;
    const s = await model(f).summarize();
    expect(s.paragraphs.map((p) => p.index)).toEqual([0, 1, 2]);
    const r = await model(f).apply([{ type: 'replaceText', paragraph: 0, find: '본문', replace: '본', guard: guardAt(f, 0) }]);
    expect(r.ok).toBe(true);
  });

  it('blocks() 는 summarize 와 같은 문단 번호로 본문 뒤에 본문 밖 문단을 잇는다(화면이 고칠 곳을 문서 위에 그릴 때 쓴다)', async () => {
    const m = model(make());
    const blocks = await m.blocks();
    expect(blocks).toHaveLength(11);
    expect(blocks[7]).toMatchObject({ text: ' 각주 글: 몇일 걸립니다.', area: { kind: 'footnote', number: 1, story: { storyType: 'footnote', noteId: '1' } } });
    expect(blocks[0]?.area).toBeUndefined();
  });
});

describe('DocxModel.apply: 머리말·꼬리말·각주·미주 안의 글', () => {
  it('머리말·꼬리말·각주·미주의 글을 바꾸고, 돌려받은 변경으로 처음 글로 되돌린다', async () => {
    const f = make();
    const m = model(f);
    const before = areaTexts(f);
    const r = await m.apply([fix(f, 3, '몇일', '며칠'), fix(f, 6, '할려고', '하려고'), fix(f, 7, '몇일', '며칠'), fix(f, 10, '미주', '후주')]);
    expect(r.ok).toBe(true);
    expect(areaTexts(f)).toEqual(['머리말 첫째 줄: 며칠 뒤', '머리말 둘째 줄', '첫 쪽 머리말입니다', '꼬리말 하려고 했어요 - ', ' 각주 글: 며칠 걸립니다.', '각주의 둘째 문단', ' 두 번째 각주', ' 후주 글입니다.']);
    // 본문은 그대로다.
    expect(f.paras.map((p) => p.text)).toEqual(BODY.map((p) => p.text));
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(areaTexts(f)).toEqual(before);
  });

  it('같은 묶음에서 본문과 본문 밖의 글을 함께 고쳐도 적용되고 되돌려진다', async () => {
    const f = make();
    const m = model(f);
    const r = await m.apply([fix(f, 1, '첫', '첫째'), fix(f, 7, '몇일', '며칠'), fix(f, 7, '걸립니다', '걸려요')]);
    expect(r.ok).toBe(true);
    expect(f.paras[1]?.text).toBe('본문 첫째 문단입니다.');
    expect(areaTexts(f)[4]).toBe(' 각주 글: 며칠 걸려요.');
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(f.paras[1]?.text).toBe('본문 첫 문단입니다.');
    expect(areaTexts(f)[4]).toBe(' 각주 글: 몇일 걸립니다.');
  });

  it('글자 서식(크기·굵게)과 문단 서식(정렬·줄 간격)을 본문 밖의 문단에도 바꾸고 되돌린다', async () => {
    const f = make();
    const m = model(f);
    const r = await m.apply([
      { type: 'setCharStyle', paragraph: 4, style: { fontSizePt: 13, bold: true }, guard: guardAt(f, 4) },
      { type: 'setCharStyle', paragraph: 7, style: { fontSizePt: 8 }, guard: guardAt(f, 7) },
      { type: 'setParaStyle', paragraph: 9, style: { align: 'center' }, guard: guardAt(f, 9) },
      { type: 'setParaStyle', paragraph: 6, style: { lineSpacingPct: 150 }, guard: guardAt(f, 6) },
    ]);
    expect(r.ok).toBe(true);
    const [h1, h2, , footer, fn1, , fn2] = f.areaParas as [ParaSpec, ParaSpec, ParaSpec, ParaSpec, ParaSpec, ParaSpec, ParaSpec];
    expect(h2).toMatchObject({ sizePt: 13, bold: true });
    expect(fn1.sizePt).toBe(8);
    expect(fn2.align).toBe('center');
    expect(footer.linePct).toBe(150);
    expect(h1.sizePt).toBe(12); // 건드리지 않은 문단
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(h2.sizePt).toBe(10);
    expect(fn1.sizePt).toBe(9);
    expect(fn2.align).toBe('right');
    expect(footer.linePct).toBe(100);
  });

  it('머리말 안의 표 칸 문단도 글과 서식을 바꿀 수 있다', async () => {
    const f = make({ header: [[[{ text: '왼쪽 칸 몇일', sizePt: 10 }, { text: '오른쪽 칸', sizePt: 10 }]], { text: '표 아래 줄' }] });
    const m = model(f);
    const r = await m.apply([fix(f, 3, '몇일', '며칠'), { type: 'setCharStyle', paragraph: 4, style: { fontSizePt: 11 }, guard: guardAt(f, 4) }]);
    expect(r.ok).toBe(true);
    expect(f.areaParas.map((p) => [p.text, p.sizePt])).toEqual([
      ['왼쪽 칸 며칠', 10],
      ['오른쪽 칸', 11],
      ['표 아래 줄', undefined],
    ]);
  });

  it('본문만 고칠 때는 본문 밖의 글을 읽지 않고, 본문 밖을 고칠 때만 읽는다', async () => {
    const f = make();
    const m = model(f);
    expect((await m.apply([fix(f, 1, '첫', '첫째')])).ok).toBe(true);
    expect(f.areaReadCount).toBe(0);
    expect((await m.apply([fix(f, 7, '몇일', '며칠')])).ok).toBe(true);
    expect(f.areaReadCount).toBe(4); // 시작·확인에서 각주·미주 목록을 한 번씩
  });

  it('고칠 문단이 편집 사이에 달라졌으면(지문이 다르면) 거절하고 아무것도 바꾸지 않는다', async () => {
    const f = make();
    const op = fix(f, 3, '몇일', '며칠');
    (f.areaParas[0] as ParaSpec).text = '누군가 이미 고친 머리말 몇일';
    const before = areaTexts(f);
    expect(await model(f).apply([op])).toMatchObject({ ok: false, reason: 'stale' });
    expect(areaTexts(f)).toEqual(before);
  });

  it('없는 문단 번호(본문 밖 문단 수를 넘는)나 줄바꿈이 든 변경은 적용하지 않는다', async () => {
    const f = make();
    const m = model(f);
    expect(await m.apply([{ type: 'replaceText', paragraph: 99, find: 'a', replace: 'b' }])).toMatchObject({ ok: false, reason: 'stale' });
    expect(await m.apply([fix(f, 3, '몇일', '며칠\n뒤')])).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('묶음 중간에 실패하면 본문 밖에서 이미 고친 글도 모두 되돌린다', async () => {
    const f = make();
    const before = areaTexts(f);
    const r = await model(f).apply([fix(f, 3, '몇일', '며칠'), fix(f, 7, '몇일', '며칠'), fix(f, 6, '없는글', 'x')]);
    expect(r.ok).toBe(false);
    expect(areaTexts(f)).toEqual(before);
  });

  it('편집기가 본문 밖의 글을 예상과 다르게 바꾸면 알리고 되돌린다', async () => {
    const f = make();
    f.mangleReplace = true;
    const r = await model(f).apply([fix(f, 7, '몇일', '며칠')]);
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect((r as { message: string }).message).toContain('글을 예상과 다르게');
    expect(areaTexts(f)[4]).not.toContain('며칠');
  });

  it('편집기가 본문 밖 문단의 서식을 바꾸지 않았는데 성공했다고 하면 실패로 알리고 되돌린다', async () => {
    const f = make();
    f.ignore.add('format');
    const r = await model(f).apply([{ type: 'setCharStyle', paragraph: 7, style: { fontSizePt: 8 }, guard: guardAt(f, 7) }]);
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect((r as { message: string }).message).toContain('글자 서식을 예상과 다르게');
  });

  it('서식을 읽지 못한 본문 밖 문단(문단 번호가 없는 파일)의 글자 서식은 거절하고 글 바꾸기는 된다', async () => {
    const f = make();
    f.exportParaIds = false;
    const m = model(f);
    expect(await m.apply([{ type: 'setCharStyle', paragraph: 4, style: { bold: true }, guard: guardAt(f, 4) }])).toMatchObject({ ok: false, reason: 'failed' });
    expect((await m.apply([fix(f, 3, '몇일', '며칠')])).ok).toBe(true);
  });
});

describe('DocxModel: 글상자 안의 문단', () => {
  it('요약에는 나오지 않지만(본문 문단으로 고칠 수 없다) 문단 번호 순서는 그대로 유지한다', async () => {
    const f = new FakeDocx([{ text: '앞 문단', ...FONT, sizePt: 10 }, { text: '상자를 단 문단', ...FONT, sizePt: 10, textBox: { text: '상자 안 몇일', ...FONT, sizePt: 10 } }, { text: '뒤 문단', ...FONT, sizePt: 10 }], { footer: [{ text: '꼬리말' }] });
    const m = model(f);
    const s = await m.summarize();
    expect(s.paragraphs.map((p) => [p.index, p.text])).toEqual([
      [0, '앞 문단'],
      [1, '상자를 단 문단'],
      [3, '뒤 문단'],
      [4, '꼬리말'],
    ]);
    // 번호 3 의 문단과 본문 밖의 문단(4)이 그 번호로 고쳐진다.
    const r = await m.apply([fix(f, 3, '뒤', '다음'), fix(f, 4, '꼬리', '아래')]);
    expect(r.ok).toBe(true);
    expect(f.paras.map((p) => p.text)).toEqual(['앞 문단', '상자를 단 문단', '상자 안 몇일', '다음 문단']);
    expect(areaTexts(f)).toEqual(['아래말']);
  });
});

describe('DocxModel.apply: 각주·미주 표시(U+FFFC) 보호', () => {
  const OBJ = '￼';

  it('각주 표시가 든 자리를 바꾸는 변경은 거절하고 문서를 건드리지 않는다(바꾸면 각주가 지워진다)', async () => {
    const f = make();
    const before = f.paras.map((p) => p.text);
    const withMark = { type: 'replaceText', paragraph: 1, find: `다.${OBJ}`, replace: '다.', guard: textGuard(`본문 첫 문단입니다.${OBJ}`) } as Op;
    expect(await model(f).apply([withMark])).toMatchObject({ ok: false, reason: 'unsupported' });
    const inserting = { type: 'replaceText', paragraph: 1, find: '다.', replace: `다.${OBJ}`, guard: textGuard(`본문 첫 문단입니다.${OBJ}`) } as Op;
    expect(await model(f).apply([inserting])).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(f.paras.map((p) => p.text)).toEqual(before);
    expect(f.rev).toBe(0);
  });

  it('각주 표시 바로 옆의 글은 바꿀 수 있다', async () => {
    const f = make();
    const r = await model(f).apply([{ type: 'replaceText', paragraph: 1, find: '문단입니다.', replace: '문단이에요.', guard: textGuard(`본문 첫 문단입니다.${OBJ}`) }]);
    expect(r.ok).toBe(true);
    expect(f.paras[1]?.text).toBe('본문 첫 문단이에요.');
  });
});
