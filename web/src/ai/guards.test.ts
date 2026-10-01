import { type AreaPlace, type CellPlace, type DocSummary, type Proposal } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { attachGuards, attachPlaces, placeOfParagraphs } from './guards';

const cellAt = (table: number, row: number, col: number, depth = 1): CellPlace => ({ table, row, col, depth });
const cells = new Map<number, CellPlace>([
  [3, cellAt(1, 2, 1)],
  [4, cellAt(1, 2, 2)],
  [9, cellAt(2, 1, 1, 2)],
]);

describe('제안의 표 위치 문구', () => {
  it('표 밖 문단뿐이면 붙이지 않는다', () => {
    expect(placeOfParagraphs([0, 1], cells)).toBeUndefined();
  });

  it('표 칸 하나면 그 칸의 위치를, 같은 표의 여러 칸이면 표 번호와 곳 수를 쓴다', () => {
    expect(placeOfParagraphs([3], cells)).toBe('표 1 · 2행 1열');
    expect(placeOfParagraphs([3, 3], cells)).toBe('표 1 · 2행 1열');
    expect(placeOfParagraphs([3, 4], cells)).toBe('표 1 안 2곳');
    expect(placeOfParagraphs([3, 9], cells)).toBe('표 안 2곳');
    expect(placeOfParagraphs([9], cells)).toBe('표 2 · 1행 1열 (표 안의 표)');
  });

  it('본문과 표 안이 섞이면 표 안이 몇 곳 포함인지 알린다', () => {
    expect(placeOfParagraphs([0, 3, 4], cells)).toBe('표 안 2곳 포함');
  });
});

describe('제안의 머리말·꼬리말·각주 위치 문구', () => {
  const note = (number: number): AreaPlace => ({ kind: 'footnote', number });
  const places = new Map<number, CellPlace | AreaPlace>([
    [3, cellAt(1, 2, 1)],
    [10, { kind: 'header', pages: 'both' }],
    [11, { kind: 'footer', pages: 'odd' }],
    [12, note(1)],
    [13, note(2)],
  ]);

  it('한 곳이면 그 위치를, 같은 종류 여러 곳이면 곳 수를 쓴다', () => {
    expect(placeOfParagraphs([10], places)).toBe('머리말');
    expect(placeOfParagraphs([11], places)).toBe('꼬리말(홀수 쪽)');
    expect(placeOfParagraphs([12], places)).toBe('각주 1');
    expect(placeOfParagraphs([12, 13], places)).toBe('각주 2곳');
  });

  it('종류가 섞이거나 본문과 섞이면 종류 이름을 나열하고 "포함"을 붙인다', () => {
    expect(placeOfParagraphs([10, 11], places)).toBe('머리말·꼬리말 2곳');
    expect(placeOfParagraphs([3, 12], places)).toBe('표·각주 2곳');
    expect(placeOfParagraphs([0, 12, 13], places)).toBe('각주 2곳 포함');
    expect(placeOfParagraphs([0, 10, 12], places)).toBe('머리말·각주 2곳 포함');
  });

  it('제안에 붙이기: 문단 정보의 area 에서 위치를 읽는다', () => {
    const summary: DocSummary = {
      kind: 'hwp',
      paragraphs: [
        { index: 0, text: '본문', char: {}, para: {} },
        { index: 1, text: '각주 글', char: {}, para: {}, area: note(3) },
      ],
    };
    const proposal = (paragraph: number): Proposal => ({
      id: `p${paragraph}`,
      category: 'spelling',
      title: 't',
      description: '',
      before: '',
      after: '',
      ops: [{ type: 'replaceText', paragraph, find: '글', replace: '말' }],
    });
    const out = attachPlaces([proposal(0), proposal(1)], summary);
    expect(out[0]?.place).toBeUndefined();
    expect(out[1]?.place).toBe('각주 3');
  });
});

describe('제안에 위치 붙이기', () => {
  const summary: DocSummary = {
    kind: 'hwp',
    paragraphs: [
      { index: 0, text: '본문', char: {}, para: {} },
      { index: 3, text: '칸 글', char: {}, para: {}, cell: cellAt(1, 2, 1) },
    ],
  };
  const proposal = (id: string, paragraph: number): Proposal => ({
    id,
    category: 'spelling',
    title: id,
    description: '',
    before: '',
    after: '',
    ops: [{ type: 'replaceText', paragraph, find: '글', replace: '말' }],
  });

  it('표 안의 글을 고치는 제안에만 위치를 붙이고, 지문 붙이기와 함께 써도 서로 지우지 않는다', () => {
    const out = attachPlaces(attachGuards([proposal('본문 제안', 0), proposal('칸 제안', 3)], summary), summary);
    expect(out[0]?.place).toBeUndefined();
    expect(out[1]?.place).toBe('표 1 · 2행 1열');
    expect(out[1]?.ops[0]?.guard).toBeDefined();
  });

  it('문서에 표 안의 글이 없으면 제안을 그대로 돌려준다(같은 객체)', () => {
    const plain: DocSummary = { kind: 'docx', paragraphs: [{ index: 0, text: '본문', char: {}, para: {} }] };
    const list = [proposal('a', 0)];
    expect(attachPlaces(list, plain)).toBe(list);
  });
});
