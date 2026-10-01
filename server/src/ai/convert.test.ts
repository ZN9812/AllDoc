import type { DocSummary } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { MAX_PROPOSALS, toProposals } from './convert';
import type { RawOp, RawProposal } from './schema';

const blank: RawOp = { type: 'replaceText', paragraph: 0, find: null, replace: null, fontFamily: null, fontSizePt: null, bold: null, italic: null, underline: null, align: null, lineSpacingPct: null };
const op = (o: Partial<RawOp>): RawOp => ({ ...blank, ...o });
const prop = (ops: RawOp[], extra: Partial<RawProposal> = {}): RawProposal => ({ category: 'spelling', title: '제목', description: '설명', before: 'a', after: 'b', ops, ...extra });

const doc = (kind: DocSummary['kind'] = 'docx'): DocSummary => ({
  kind,
  paragraphs: [
    { index: 0, text: '제출기한을 지켜 주세요', char: {}, para: {} },
    { index: 4, text: '자료를 보내 주세요', char: { fontSizePt: 11 }, para: {} },
  ],
});
let n = 0;
const id = () => `id${++n}`;

describe('AI 제안 걸러내기', () => {
  it('문서와 맞는 글 바꾸기는 엄격한 제안으로 바뀐다', () => {
    const r = toProposals([prop([op({ paragraph: 0, find: '제출기한을', replace: '제출 기한을' })])], doc(), id);
    expect(r.dropped).toBe(0);
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]).toMatchObject({ category: 'spelling', ops: [{ type: 'replaceText', paragraph: 0, find: '제출기한을', replace: '제출 기한을' }] });
    expect(r.proposals[0]?.id).toMatch(/^id/);
  });

  it('문단 번호는 문서가 정한 번호(index)로 대조한다', () => {
    expect(toProposals([prop([op({ paragraph: 4, find: '자료를', replace: '자료도' })])], doc(), id).proposals).toHaveLength(1);
    expect(toProposals([prop([op({ paragraph: 1, find: '자료를', replace: '자료도' })])], doc(), id).dropped).toBe(1);
  });

  it('문단에 없는 글, 같은 글로 바꾸기, 빈 find 는 버린다', () => {
    expect(toProposals([prop([op({ paragraph: 0, find: '없는글', replace: 'x' })])], doc(), id).dropped).toBe(1);
    expect(toProposals([prop([op({ paragraph: 0, find: '제출기한을', replace: '제출기한을' })])], doc(), id).dropped).toBe(1);
    expect(toProposals([prop([op({ paragraph: 0, find: '', replace: 'x' })])], doc(), id).dropped).toBe(1);
    expect(toProposals([prop([op({ paragraph: 0, find: '제출', replace: null })])], doc(), id).dropped).toBe(1);
  });

  it('글을 지우는 제안(빈 문자열로 바꾸기)은 받아들인다', () => {
    const r = toProposals([prop([op({ paragraph: 0, find: ' 주세요', replace: '' })])], doc(), id);
    expect(r.proposals).toHaveLength(1);
  });

  it('한 제안의 변경 중 하나라도 잘못이면 제안 전체를 버린다', () => {
    const r = toProposals([prop([op({ paragraph: 0, find: '제출기한을', replace: '제출 기한을' }), op({ paragraph: 99, find: 'x', replace: 'y' })])], doc(), id);
    expect(r).toMatchObject({ proposals: [], dropped: 1 });
  });

  it('서식 변경: 한글·Word 에서만, 값이 정상 범위일 때만', () => {
    const style = (o: Partial<RawOp>) => prop([op({ type: 'setCharStyle', paragraph: 0, ...o })], { category: 'format' });
    expect(toProposals([style({ fontSizePt: 12 })], doc('hwpx'), id).proposals[0]?.ops[0]).toEqual({ type: 'setCharStyle', paragraph: 0, style: { fontSizePt: 12 } });
    expect(toProposals([style({ fontSizePt: 12 })], doc('txt'), id).dropped).toBe(1);
    expect(toProposals([style({ fontSizePt: 0 })], doc(), id).dropped).toBe(1);
    expect(toProposals([style({ fontSizePt: 500 })], doc(), id).dropped).toBe(1);
    expect(toProposals([style({})], doc(), id).dropped).toBe(1);
    expect(toProposals([style({ fontFamily: '  맑은 고딕  ', bold: true })], doc(), id).proposals[0]?.ops[0]).toEqual({
      type: 'setCharStyle',
      paragraph: 0,
      style: { fontFamily: '맑은 고딕', bold: true },
    });
  });

  it('문단 서식: 정렬과 줄 간격', () => {
    const p = (o: Partial<RawOp>) => prop([op({ type: 'setParaStyle', paragraph: 0, ...o })], { category: 'format' });
    expect(toProposals([p({ align: 'center', lineSpacingPct: 160 })], doc(), id).proposals[0]?.ops[0]).toEqual({ type: 'setParaStyle', paragraph: 0, style: { align: 'center', lineSpacingPct: 160 } });
    expect(toProposals([p({ lineSpacingPct: 10 })], doc(), id).dropped).toBe(1);
    expect(toProposals([p({})], doc(), id).dropped).toBe(1);
  });

  it('제목이 비었거나 변경이 없는 제안은 버리고, 너무 많으면 앞의 30개만 남긴다', () => {
    expect(toProposals([prop([])], doc(), id).dropped).toBe(1);
    expect(toProposals([prop([op({ paragraph: 0, find: '제출', replace: '납부' })], { title: '  ' })], doc(), id).dropped).toBe(1);
    const many = Array.from({ length: MAX_PROPOSALS + 5 }, () => prop([op({ paragraph: 0, find: '제출', replace: '납부' })]));
    const r = toProposals(many, doc(), id);
    expect(r.proposals).toHaveLength(MAX_PROPOSALS);
    expect(r.dropped).toBe(5);
  });

  it('긴 글은 카드에 맞게 줄이고, 비어 있는 before/after 는 변경에서 채운다', () => {
    const r = toProposals([prop([op({ paragraph: 0, find: '제출', replace: '납부' })], { title: 'a'.repeat(200), description: 'b'.repeat(900), before: '', after: '' })], doc(), id);
    const p = r.proposals[0];
    expect(p?.title.length).toBeLessThanOrEqual(60);
    expect(p?.description.length).toBeLessThanOrEqual(300);
    expect(p).toMatchObject({ before: '제출', after: '납부' });
  });
});
