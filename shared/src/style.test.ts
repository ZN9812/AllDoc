import { describe, expect, it } from 'vitest';
import { ParagraphInfoSchema, placeLabel } from './style';

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
