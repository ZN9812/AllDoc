import { describe, expect, it } from 'vitest';
import { areaLabel, areaName, isBodyParagraph, ParagraphInfoSchema, placeLabel, placeOfParagraph } from './style';

describe('표 칸 위치', () => {
  it('본문의 표 칸은 표 번호와 행·열만, 표 안의 표는 그렇다고 덧붙인다', () => {
    expect(placeLabel({ table: 2, row: 3, col: 1, depth: 1 })).toBe('표 2 · 3행 1열');
    expect(placeLabel({ table: 5, row: 1, col: 2, depth: 2 })).toBe('표 5 · 1행 2열 (표 안의 표)');
  });

  it('문단 정보의 cell 은 없어도 되고, 있으면 위치 규칙을 지킨다', () => {
    const base = { index: 0, text: '글', char: {}, para: {} };
    expect(ParagraphInfoSchema.safeParse(base).success).toBe(true);
    expect(ParagraphInfoSchema.safeParse({ ...base, cell: { table: 1, row: 1, col: 1, depth: 1 } }).success).toBe(true);
    expect(ParagraphInfoSchema.safeParse({ ...base, cell: { table: 0, row: 1, col: 1, depth: 1 } }).success).toBe(false);
  });

  it('서버가 요청을 검증해도 cell 이 지워지지 않는다(AI 프롬프트가 위치를 알 수 있어야 한다)', () => {
    const parsed = ParagraphInfoSchema.parse({ index: 3, text: '성명', char: {}, para: {}, cell: { table: 1, row: 2, col: 1, depth: 1 } });
    expect(parsed.cell).toEqual({ table: 1, row: 2, col: 1, depth: 1 });
  });
});

describe('본문 밖 영역(머리말·꼬리말·각주·미주) 위치', () => {
  it('영역 이름과 번호·쪽·구역을 사람이 읽는 문구로 만든다', () => {
    expect(areaLabel({ kind: 'header', pages: 'both' })).toBe('머리말');
    expect(areaLabel({ kind: 'footer', pages: 'odd' })).toBe('꼬리말(홀수 쪽)');
    expect(areaLabel({ kind: 'header', pages: 'even', section: 2 })).toBe('머리말(짝수 쪽) · 구역 2');
    expect(areaLabel({ kind: 'footer', pages: 'first' })).toBe('꼬리말(첫 쪽)');
    expect(areaLabel({ kind: 'textbox', number: 2 })).toBe('글상자 2');
    expect(areaName({ kind: 'textbox', number: 2 })).toBe('글상자');
    expect(areaLabel({ kind: 'footnote', number: 3 })).toBe('각주 3');
    expect(areaLabel({ kind: 'endnote', number: 1, section: 2 })).toBe('미주 1 · 구역 2');
    expect(areaName({ kind: 'footnote', number: 3 })).toBe('각주');
  });

  it('캡션 위치는 "그림 캡션 N"과 "표 N 캡션"으로 쓴다(표 번호는 표 칸의 위치 문구와 같다)', () => {
    expect(areaLabel({ kind: 'caption', of: 'picture', number: 1 })).toBe('그림 캡션 1');
    expect(areaLabel({ kind: 'caption', of: 'table', number: 2 })).toBe('표 2 캡션');
    expect(areaLabel({ kind: 'caption', of: 'table' })).toBe('표 캡션');
    expect(areaName({ kind: 'caption', of: 'table', number: 2 })).toBe('캡션');
    const base = { index: 0, text: '글', char: {}, para: {} };
    expect(ParagraphInfoSchema.parse({ ...base, area: { kind: 'caption', of: 'table', number: 2 } }).area).toEqual({ kind: 'caption', of: 'table', number: 2 }); // 서버가 검증해도 of 가 지워지지 않는다
    expect(ParagraphInfoSchema.safeParse({ ...base, area: { kind: 'caption', of: 'chart', number: 2 } }).success).toBe(false);
  });

  it('문단 정보의 area 는 없어도 되고, 있으면 규칙을 지키며, 서버가 검증해도 지워지지 않는다', () => {
    const base = { index: 0, text: '글', char: {}, para: {} };
    expect(ParagraphInfoSchema.safeParse({ ...base, area: { kind: 'footnote', number: 2 } }).success).toBe(true);
    expect(ParagraphInfoSchema.safeParse({ ...base, area: { kind: 'sidebar' } }).success).toBe(false);
    expect(ParagraphInfoSchema.safeParse({ ...base, area: { kind: 'footnote', number: 0 } }).success).toBe(false);
    expect(ParagraphInfoSchema.parse({ ...base, area: { kind: 'header', pages: 'odd' } }).area).toEqual({ kind: 'header', pages: 'odd' });
  });

  it('본문 문단인지와 위치 문구는 표 칸과 영역을 모두 다룬다', () => {
    expect(isBodyParagraph({})).toBe(true);
    expect(isBodyParagraph({ cell: { table: 1, row: 1, col: 1, depth: 1 } })).toBe(false);
    expect(isBodyParagraph({ area: { kind: 'footer' } })).toBe(false);
    expect(placeOfParagraph({})).toBeUndefined();
    expect(placeOfParagraph({ cell: { table: 1, row: 2, col: 3, depth: 1 } })).toBe('표 1 · 2행 3열');
    expect(placeOfParagraph({ area: { kind: 'footnote', number: 4 } })).toBe('각주 4');
  });
});
