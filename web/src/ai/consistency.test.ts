import type { DocSummary, ParagraphInfo } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { analyzeConsistency, assignRoles, buildProfile, compareToProfile, roleOf, summarizeFindings } from './consistency';

let seq = 0;
function para(text: string, char: ParagraphInfo['char'] = {}, para: ParagraphInfo['para'] = {}, index = seq++): ParagraphInfo {
  return { index, text, char, para };
}
const doc = (paragraphs: ParagraphInfo[]): DocSummary => ({ kind: 'docx', paragraphs });

describe('문단 역할 추정', () => {
  it('번호·글머리 모양으로 역할을 정한다', () => {
    expect(roleOf('1. 목적')).toBe('level1');
    expect(roleOf('12. 일정')).toBe('level1');
    expect(roleOf('가. 세부')).toBe('level2');
    expect(roleOf('(1) 하위')).toBe('level3');
    expect(roleOf('① 항목')).toBe('level4');
    expect(roleOf('- 메모')).toBe('bullet');
    expect(roleOf('그냥 문장입니다.')).toBe('body');
  });

  it('첫 문단이 가운데 정렬이고 본문보다 크면 제목으로 본다', () => {
    const items = assignRoles([
      para('업무 협조 요청', { fontSizePt: 18 }, { align: 'center' }, 0),
      para('본문 하나', { fontSizePt: 11 }, {}, 1),
      para('본문 둘', { fontSizePt: 11 }, {}, 2),
    ]);
    expect(items.map((i) => i.role)).toEqual(['title', 'body', 'body']);
  });

  it('빈 문단은 역할을 붙이지 않는다', () => {
    expect(assignRoles([para('  ', {}, {}, 0), para('글', {}, {}, 1)])).toHaveLength(1);
  });
});

describe('문서 안 일관성 점검', () => {
  const numbered = (size: number, font = '맑은 고딕') => (n: number, i: number) => para(`${n}. 항목 ${n}`, { fontFamily: font, fontSizePt: size }, {}, i);

  it('같은 역할인데 소수만 글자 크기가 다르면 찾아서 다수에 맞추는 제안을 만든다', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n, i) => numbered(n === 4 ? 13 : 12)(n, i));
    const r = analyzeConsistency(doc(items));
    const f = r.findings.find((x) => x.attr === 'fontSizePt');
    expect(f).toBeDefined();
    expect(f?.paragraphs).toEqual([3]);
    expect(f?.proposal.before).toBe('13pt');
    expect(f?.proposal.after).toBe('12pt');
    expect(f?.proposal.ops).toEqual([{ type: 'setCharStyle', paragraph: 3, style: { fontSizePt: 12 } }]);
    expect(f?.proposal.category).toBe('format');
  });

  it('문단 번호는 배열 위치가 아니라 문서가 정한 번호(index)를 쓴다', () => {
    const items = [1, 2, 3, 4].map((n, i) => numbered(n === 2 ? 14 : 12)(n, 100 + i * 2));
    const f = analyzeConsistency(doc(items)).findings.find((x) => x.attr === 'fontSizePt');
    expect(f?.paragraphs).toEqual([102]);
  });

  it('글꼴이 다른 곳도 찾는다', () => {
    const items = [1, 2, 3, 4, 5].map((n, i) => numbered(12, n === 5 ? '굴림' : '맑은 고딕')(n, i));
    const f = analyzeConsistency(doc(items)).findings.find((x) => x.attr === 'fontFamily');
    expect(f?.proposal.before).toBe('굴림');
    expect(f?.proposal.after).toBe('맑은 고딕');
  });

  it('절반 가까이가 다르면 어느 쪽이 맞는지 알 수 없으므로 지적하지 않는다', () => {
    const items = [1, 2, 3, 4].map((n, i) => numbered(n <= 2 ? 12 : 13)(n, i));
    expect(analyzeConsistency(doc(items)).findings).toEqual([]);
  });

  it('항목이 3개 미만이면 지적하지 않는다', () => {
    const items = [1, 2].map((n, i) => numbered(n === 2 ? 13 : 12)(n, i));
    expect(analyzeConsistency(doc(items)).findings).toEqual([]);
  });

  it('서로 다른 역할은 서로 다른 서식이어도 된다', () => {
    const items = [
      ...[1, 2, 3].map((n, i) => numbered(12)(n, i)),
      ...[0, 1, 2, 3, 4].map((_, i) => para(`가. 세부 ${i}`, { fontFamily: '맑은 고딕', fontSizePt: 10 }, {}, 10 + i)),
    ];
    expect(analyzeConsistency(doc(items)).findings).toEqual([]);
  });

  it('서식 정보가 없는 문서(TXT 등)는 아무것도 지적하지 않는다', () => {
    const items = [1, 2, 3, 4, 5].map((n, i) => para(`${n}. 항목`, {}, {}, i));
    expect(analyzeConsistency(doc(items)).findings).toEqual([]);
  });

  it('같은 입력이면 제안 id 가 같다(다시 점검해도 중복으로 올라가지 않는다)', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n, i) => numbered(n === 4 ? 13 : 12)(n, i));
    const a = analyzeConsistency(doc(items)).findings.map((f) => f.id);
    const b = analyzeConsistency(doc(items)).findings.map((f) => f.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('번호 체계 점검', () => {
  const nums = (...n: number[]) => doc(n.map((x, i) => para(`${x}. 항목`, {}, {}, i)));

  it('1, 2, 3 으로 이어지면 이상 없음', () => {
    expect(analyzeConsistency(nums(1, 2, 3)).numbering.status).toBe('ok');
  });

  it('건너뛰거나 중복되면 알려 준다', () => {
    const r = analyzeConsistency(nums(1, 2, 4));
    expect(r.numbering.status).toBe('irregular');
    expect(r.numbering.detail).toContain('1, 2, 4');
    expect(analyzeConsistency(nums(1, 1, 2)).numbering.status).toBe('irregular');
  });

  it('번호 항목이 3개 미만이면 판단하지 않는다', () => {
    expect(analyzeConsistency(nums(1, 2)).numbering.status).toBe('na');
  });

  it('결과 줄에 번호 점검이 함께 나온다', () => {
    const rows = summarizeFindings(analyzeConsistency(nums(1, 2, 4)));
    expect(rows.some((r) => r.id === 'numbering' && !r.ok)).toBe(true);
    const okRows = summarizeFindings(analyzeConsistency(nums(1, 2, 3)));
    expect(okRows.some((r) => r.id === 'numbering' && r.ok)).toBe(true);
  });
});

describe('기준 문서', () => {
  const reference = doc([
    para('1. 첫째', { fontFamily: '함초롬바탕', fontSizePt: 13 }, {}, 0),
    para('2. 둘째', { fontFamily: '함초롬바탕', fontSizePt: 13 }, {}, 1),
    para('3. 셋째', { fontFamily: '함초롬바탕', fontSizePt: 13 }, {}, 2),
    para('본문입니다', { fontFamily: '함초롬바탕', fontSizePt: 11 }, { lineSpacingPct: 160 }, 3),
    para('본문 둘', { fontFamily: '함초롬바탕', fontSizePt: 11 }, { lineSpacingPct: 160 }, 4),
  ]);

  it('역할별로 가장 많이 쓰인 서식을 뽑는다', () => {
    const profile = buildProfile(reference, '양식.hwp');
    expect(profile.source).toBe('양식.hwp');
    const level1 = profile.groups.find((g) => g.label.startsWith('번호 항목'));
    expect(level1?.char).toEqual({ fontFamily: '함초롬바탕', fontSizePt: 13 });
    const body = profile.groups.find((g) => g.label === '본문');
    expect(body?.para.lineSpacingPct).toBe(160);
  });

  it('내 문서에서 기준과 다른 곳을 찾아 기준 서식에 맞추는 제안을 만든다', () => {
    const profile = buildProfile(reference, '양식.hwp');
    const mine = doc([
      para('1. 항목', { fontFamily: '굴림', fontSizePt: 13 }, {}, 5),
      para('2. 항목', { fontFamily: '함초롬바탕', fontSizePt: 13 }, {}, 6),
      para('본문', { fontFamily: '함초롬바탕', fontSizePt: 11 }, { lineSpacingPct: 130 }, 7),
    ]);
    const proposals = compareToProfile(mine, profile);
    const font = proposals.find((p) => p.title.includes('글꼴'));
    expect(font?.ops).toEqual([{ type: 'setCharStyle', paragraph: 5, style: { fontFamily: '함초롬바탕' } }]);
    const spacing = proposals.find((p) => p.title.includes('줄 간격'));
    expect(spacing?.ops).toEqual([{ type: 'setParaStyle', paragraph: 7, style: { lineSpacingPct: 160 } }]);
    expect(proposals.every((p) => p.description.includes('양식.hwp'))).toBe(true);
  });

  it('이미 기준과 같으면 제안이 없다', () => {
    const profile = buildProfile(reference, '양식.hwp');
    expect(compareToProfile(reference, profile)).toEqual([]);
  });
});
