import { describe, expect, it } from 'vitest';
import { applyFirst, checkTexEdit, fixableBlocks, mathSegments, mentionsMath, type TexEditInput } from './check';
import { blockIndex } from './chunk';

const strict = (before: string, after: string, over: Partial<TexEditInput> = {}) => checkTexEdit({ mode: 'strict', role: 'body', before, after, ...over });
const loose = (before: string, after: string, over: Partial<TexEditInput> = {}) => checkTexEdit({ mode: 'loose', role: 'body', before, after, ...over });

describe('LaTeX 제안 검증: 엄격 모드(대화·다듬기)', () => {
  it('글만 고친 제안은 통과한다(허용 목록의 \\emph 를 더하는 것 포함)', () => {
    expect(strict('몇일 뒤에 \\ref{sec:a} 를 본다.', '며칠 뒤에 \\ref{sec:a} 를 본다.')).toBeNull();
    expect(strict('중요한 결과다.', '\\emph{중요한} 결과다.')).toBeNull();
    expect(strict('50\\% 이다.', '50\\%이다.')).toBeNull();
  });

  it('규칙 1: 이스케이프되지 않은 중괄호 짝이 바뀌면 버린다(\\{ 는 세지 않는다)', () => {
    expect(strict('\\textbf{가} 나', '\\textbf{가 나')).toBe('braces');
    expect(strict('집합 \\{1\\}', '집합 \\{1, 2\\}')).toBeNull();
  });

  it('규칙 2: \\begin/\\end 순서가 바뀌면 버린다', () => {
    expect(strict('\\begin{itemize}\\item 가\\end{itemize}', '\\begin{enumerate}\\item 가\\end{enumerate}')).toBe('envs');
  });

  it('규칙 3: 라벨·참조·인용 키 묶음이 바뀌면 버린다', () => {
    expect(strict('그림~\\ref{fig:a} 참고', '그림~\\ref{fig:b} 참고')).toBe('keys');
    expect(strict('\\cite{kim2020,lee2021} 에 따르면', '\\cite{kim2020} 에 따르면')).toBe('keys');
    expect(strict('\\parencite[12쪽]{kim} 에서', '\\parencite[13쪽]{kim} 에서')).toBeNull();
  });

  it('규칙 4: 수식 구간이 바뀌면 버리고, 지시에 수식이 언급되면 허용한다', () => {
    expect(strict('값은 $x^2$ 이다.', '값은 $x^3$ 이다.')).toBe('math');
    expect(strict('값은 $x^2$ 이다.', '값은 $x^3$ 이다.', { mathAllowed: true })).toBeNull();
    expect(strict('\\[ a=b \\] 이다', '\\[ a = b \\] 이다')).toBe('math');
    expect(mentionsMath('수식을 고쳐 줘')).toBe(true);
    expect(mentionsMath('형식을 맞춰 줘')).toBe(false);
  });

  it('규칙 5: 수식 밖의 명령 묶음이 바뀌면 버린다(허용 목록 제외)', () => {
    expect(strict('가 \\newpage 나', '가 나 다')).toBe('commands');
    expect(strict('가\\\\ 나', '가 나')).toBeNull();
    expect(strict('\\textbf{가} 다', '\\textit{가} 다')).toBeNull();
    expect(strict('\\section{가}', '\\subsection{가}')).toBe('commands');
  });

  it('규칙 6: 수식 밖의 이스케이프 안 된 % & # _ ^ 수가 바뀌면 버린다(한국어 글의 "50%" 는 뒤를 주석으로 만든다)', () => {
    expect(strict('50\\% 이다', '50% 이다')).toBe('specials');
    expect(strict('A \\& B', 'A & B')).toBe('specials');
    expect(strict('변수 $a_1$ 이다', '변수 $a_1$ 이다 _')).toBe('specials');
    // 수식 안의 _ ^ 는 세지 않는다.
    expect(strict('$a_1$ 과 $b^2$', '$a_1$와 $b^2$')).toBeNull();
  });

  it('규칙 7: 블록 안의 빈 줄 수가 바뀌면 버린다(블록 번호가 밀리지 않도록)', () => {
    expect(strict('가\n나', '가\n\n나')).toBe('blanks');
    expect(loose('가\n나', '가\n\n나')).toBe('blanks');
  });

  it('규칙 8: 주석·verbatim·서문 블록은 고치지 않는다', () => {
    for (const role of ['comment', 'verbatim', 'preamble'] as const) expect(strict('% 가', '% 나', { role })).toBe('role');
    expect(strict('가', '나', { role: 'bib' })).toBeNull();
    expect(strict('가', '나', { role: 'math' })).toBeNull();
  });
});

describe('LaTeX 제안 검증: 느슨한 모드(오류 고치기)', () => {
  it('환경 이름·명령을 고칠 수 있고 서문도 고칠 수 있지만, verbatim 은 안 된다', () => {
    expect(loose('\\begin{itemise}\n\\item 가\n\\end{itemise}', '\\begin{itemize}\n\\item 가\n\\end{itemise}')).toBeNull();
    expect(loose('\\usepackage{kotex}', '\\usepackage{kotex}\n\\usepackage{amsmath}', { role: 'preamble' })).toBeNull();
    expect(loose('x', 'y', { role: 'verbatim' })).toBe('role');
  });

  it('중괄호 짝이 더 나빠지면 버리고, 좋아지면 받는다', () => {
    expect(loose('\\textbf{가} 나', '\\textbf{가 나')).toBe('braces');
    expect(loose('\\textbf{가 나', '\\textbf{가} 나')).toBeNull();
  });

  it('고칠 수 있는 블록은 진단된 줄이 든 블록의 앞뒤 2블록과 서문', () => {
    const blocks = [
      { index: blockIndex(0, 0), file: 'main.tex', line: 1, role: 'preamble' as const },
      ...Array.from({ length: 8 }, (_, i) => ({ index: blockIndex(0, i + 1), file: 'main.tex', line: 10 + i * 3, role: 'body' as const })),
      { index: blockIndex(1, 0), file: 'ch.tex', line: 1, role: 'body' as const },
    ];
    // 줄 20 은 순번 4(줄 19~21) 블록 안
    const ok = fixableBlocks(blocks, [{ file: 'main.tex', line: 20 }]);
    expect([...ok].sort((a, b) => a - b)).toEqual([0, 2, 3, 4, 5, 6]);
    expect(fixableBlocks(blocks, [{ file: null, line: null }])).toEqual(new Set([0]));
  });
});

describe('도우미', () => {
  it('첫 위치에서 한 번만 바꾼다(클라이언트와 같게)', () => {
    expect(applyFirst('가 가', '가', '나')).toBe('나 가');
    expect(applyFirst('가', '다', '나')).toBeNull();
  });

  it('수식 구간을 찾고 주석 안의 $ 는 보지 않는다', () => {
    expect(mathSegments('a $x$ b $$y$$ \\(z\\) % $w$').segments).toEqual(['$$y$$', '$x$', '\\(z\\)'].sort((a, b) => ('a $x$ b $$y$$ \\(z\\)'.indexOf(a) - 'a $x$ b $$y$$ \\(z\\)'.indexOf(b))));
    expect(mathSegments('\\begin{align*} a \\end{align*} 와').segments).toEqual(['\\begin{align*} a \\end{align*}']);
  });
});
