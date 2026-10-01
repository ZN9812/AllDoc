import { describe, expect, it } from 'vitest';
import { applyTextOp, rangeOf, segmentText, summarizeText } from './model';

const text = ['업무 협조 요청', '', '1. 제출기한을 지켜 주세요.', '2. 자료를 보내 주세요.'].join('\n');

describe('글 문서 요약', () => {
  it('빈 줄은 빼고, 줄 번호를 문단 번호로 쓴다', () => {
    const s = summarizeText(text, 'txt');
    expect(s.paragraphs.map((p) => p.index)).toEqual([0, 2, 3]);
    expect(s.paragraphs[1]?.text).toBe('1. 제출기한을 지켜 주세요.');
  });
});

describe('글 바꾸기와 되돌리기', () => {
  it('글을 바꾸고, 역변경으로 정확히 되돌린다', () => {
    const r = applyTextOp(text, { type: 'replaceText', paragraph: 2, find: '제출기한을', replace: '제출 기한을' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('1. 제출 기한을 지켜 주세요.');
    const back = applyTextOp(r.text, r.inverse);
    expect(back.ok && back.text).toBe(text);
  });

  it('같은 글이 여러 번 나와도 바꾼 자리에서 되돌린다', () => {
    const t = '가나 가나 다라';
    const r = applyTextOp(t, { type: 'replaceText', paragraph: 0, find: '가나', replace: '가 나', at: 3 });
    expect(r.ok && r.text).toBe('가나 가 나 다라');
    if (!r.ok) return;
    const back = applyTextOp(r.text, r.inverse);
    expect(back.ok && back.text).toBe(t);
  });

  it('글을 지웠다가(빈 문자열) 되돌려도 원래대로 돌아온다', () => {
    const t = '안녕하세요 여러분';
    const r = applyTextOp(t, { type: 'replaceText', paragraph: 0, find: ' 여러분', replace: '' });
    expect(r.ok && r.text).toBe('안녕하세요');
    if (!r.ok) return;
    const back = applyTextOp(r.text, r.inverse);
    expect(back.ok && back.text).toBe(t);
  });

  it('문서가 바뀌어 글을 찾을 수 없으면 stale', () => {
    const r = applyTextOp(text, { type: 'replaceText', paragraph: 2, find: '없는글', replace: 'x' });
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    const r2 = applyTextOp(text, { type: 'replaceText', paragraph: 99, find: 'a', replace: 'b' });
    expect(r2).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('서식 변경은 지원하지 않는다', () => {
    const r = applyTextOp(text, { type: 'setCharStyle', paragraph: 0, style: { fontSizePt: 12 } });
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});

describe('표시할 범위', () => {
  it('글 전체 위치를 구한다', () => {
    expect(rangeOf(text, { paragraph: 0 })).toEqual([0, 8]);
    const r = rangeOf(text, { paragraph: 2, find: '제출기한을' });
    expect(r && text.slice(r[0], r[1])).toBe('제출기한을');
    expect(rangeOf(text, { paragraph: 1 })).toBeNull();
  });

  it('표시하는 곳과 아닌 곳으로 자른 뒤 합치면 원문과 같다', () => {
    const seg = segmentText(text, [{ paragraph: 2, find: '제출기한을' }, { paragraph: 3 }], [{ paragraph: 2, find: '제출기한을' }]);
    expect(seg.map((s) => s.text).join('')).toBe(text);
    expect(seg.some((s) => s.mark === 'focus' && s.text === '제출기한을')).toBe(true);
    expect(seg.some((s) => s.mark === 'pending' && s.text === '2. 자료를 보내 주세요.')).toBe(true);
  });
});
