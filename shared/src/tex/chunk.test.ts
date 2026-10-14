import { describe, expect, it } from 'vitest';
import { blankLineCount, blockAtLine, SLOT_SIZE, splitBib, splitFile, splitTex, stripComment } from './chunk';

const MAIN = [
  '\\documentclass{article}', // 1
  '\\usepackage{kotex}', // 2
  '', // 3
  '\\begin{document}', // 4
  '\\section{서론}', // 5
  '첫 문단이다. 50\\% 를 넘는다.', // 6
  '줄을 바꿔 이어지는 같은 문단이다.', // 7
  '', // 8
  '% 주석만 있는 블록', // 9
  '% 둘째 줄', // 10
  '', // 11
  '\\begin{equation}', // 12
  '  a = b', // 13
  '', // 14
  '  + c', // 15
  '\\end{equation}', // 16
  '', // 17
  '\\begin{verbatim}', // 18
  'x', // 19
  '', // 20
  '%y', // 21
  '\\end{verbatim}', // 22
  '', // 23
  '\\[', // 24
  'x^2', // 25
  '', // 26
  '\\]', // 27
  '', // 28
  '끝. \\end{document}', // 29
].join('\n');

describe('LaTeX 블록 나누기', () => {
  it('주 파일은 서문 하나와, 빈 줄로 나눈 블록들(수식·verbatim·\\[…\\] 안의 빈 줄에서는 나누지 않음)', () => {
    const bs = splitTex(MAIN, 'main.tex', 0, true);
    expect(bs.map((b) => [b.index, b.line, b.endLine, b.role])).toEqual([
      [0, 1, 2, 'preamble'],
      [1, 4, 7, 'body'],
      [2, 9, 10, 'comment'],
      [3, 12, 16, 'math'],
      [4, 18, 22, 'verbatim'],
      [5, 24, 27, 'math'],
      [6, 29, 29, 'body'],
    ]);
    // 블록 글은 파일의 [start, end) 를 그대로 자른 것이다.
    for (const b of bs) expect(MAIN.slice(b.start, b.end)).toBe(b.text);
    expect(bs[1]?.text).toBe('\\begin{document}\n\\section{서론}\n첫 문단이다. 50\\% 를 넘는다.\n줄을 바꿔 이어지는 같은 문단이다.');
  });

  it('주 파일이 아니면 서문이 없고, 번호는 파일칸 × 100000 + 순번', () => {
    const bs = splitTex('\\section{가}\n\n본문\n', 'ch/1.tex', 3, false);
    expect(bs.map((b) => [b.index, b.role, b.text])).toEqual([
      [3 * SLOT_SIZE, 'body', '\\section{가}'],
      [3 * SLOT_SIZE + 1, 'body', '본문'],
    ]);
  });

  it('주석 안의 \\begin{document} 와 \\begin{equation} 은 치지 않는다', () => {
    const bs = splitTex('% \\begin{document}\n\\begin{document}\n% \\begin{equation}\n가\n\n나', 'm.tex', 0, true);
    expect(bs.map((b) => b.role)).toEqual(['preamble', 'body', 'body']);
  });

  it('\\verb 가 든 블록은 verbatim 으로 본다', () => {
    expect(splitTex('글 \\verb|\\x| 이다', 'a.tex', 0, false)[0]?.role).toBe('verbatim');
  });

  it('.bib 는 @항목 하나가 블록 하나', () => {
    const bib = '% 머리 주석\n@book{a,\n  title={가},\n}\n\n@article{b, title={나}}\n';
    const bs = splitBib(bib, 'refs.bib', 1);
    expect(bs.map((b) => [b.index, b.line, b.text])).toEqual([
      [SLOT_SIZE, 2, '@book{a,\n  title={가},\n}'],
      [SLOT_SIZE + 1, 6, '@article{b, title={나}}'],
    ]);
    expect(splitFile(bib, 'refs.bib', 1, false)).toHaveLength(2);
    expect(splitFile('x', 'a.png', 0, false)).toEqual([]);
  });

  it('줄 번호로 블록을 찾고, 빈 줄 수와 주석 떼기를 계산한다', () => {
    const bs = splitTex(MAIN, 'main.tex', 0, true);
    expect(blockAtLine(bs, 7)?.index).toBe(1);
    expect(blockAtLine(bs, 8)?.index).toBe(1);
    expect(blockAtLine(bs, 14)?.index).toBe(3);
    expect(blankLineCount('\n가\n\n나\n')).toBe(1);
    expect(blankLineCount('가\n나')).toBe(0);
    expect(stripComment('50\\% 이다 % 주석')).toBe('50\\% 이다 ');
  });
});
