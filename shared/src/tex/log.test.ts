import { describe, expect, it } from 'vitest';
import { countBySeverity, MAX_DIAGNOSTICS, parseTexLog } from './log';

// 시험 자료는 이 기계(Ubuntu 패키지 TeX Live 2023)에서 latexmk -xelatex -file-line-error, max_print_line=10000 으로 만든 실제 로그다.
// (shared 는 Node 형식을 쓰지 않으므로 파일을 직접 읽지 않고 Vite 의 ?raw 로 불러온다)
import biberBlg from './fixtures/biber-warning.blg?raw';
import bibtexBlg from './fixtures/bibtex-warning.blg?raw';
import errorsLog from './fixtures/xelatex-errors.log?raw';
import missingLog from './fixtures/xelatex-missing-package.log?raw';
import warningsLog from './fixtures/xelatex-warnings.log?raw';

const FIXTURES: Record<string, string> = {
  'xelatex-errors.log': errorsLog,
  'xelatex-missing-package.log': missingLog,
  'xelatex-warnings.log': warningsLog,
  'bibtex-warning.blg': bibtexBlg,
  'biber-warning.blg': biberBlg,
};
const fixture = (name: string): string => FIXTURES[name] as string;

describe('LaTeX 로그 해석(실제 로그)', () => {
  it('오류는 -file-line-error 의 파일·줄을 그대로 쓰고, 경고는 괄호를 따라가 하위 파일을 찾는다', () => {
    const ds = parseTexLog(fixture('xelatex-errors.log'));
    expect(ds.filter((d) => d.severity === 'error')).toEqual([
      { severity: 'error', file: 'chapters/intro.tex', line: 2, message: 'Undefined control sequence.' },
      { severity: 'error', file: 'main.tex', line: 8, message: 'LaTeX Error: Environment itemise undefined.' },
      { severity: 'error', file: 'main.tex', line: 9, message: 'LaTeX Error: Lonely \\item--perhaps a missing list environment.' },
      { severity: 'error', file: 'main.tex', line: 10, message: 'LaTeX Error: \\begin{document} ended by \\end{itemise}.' },
    ]);
    // 하위 파일(chapters/intro.tex) 안의 경고는 그 파일로, 닫는 괄호 뒤의 경고는 다시 main.tex 로
    expect(ds).toContainEqual({ severity: 'warning', file: 'chapters/intro.tex', line: 4, message: "LaTeX Warning: Reference `sec:missing' on page 1 undefined" });
    expect(ds).toContainEqual({ severity: 'warning', file: 'main.tex', line: 6, message: "LaTeX Warning: Reference `fig:none' on page 1 undefined" });
    expect(ds).toContainEqual({ severity: 'warning', file: 'main.tex', line: 12, message: "LaTeX Warning: Citation `nokey' on page 1 undefined" });
    expect(ds).toContainEqual({ severity: 'warning', file: 'main.tex', line: 11, message: 'Overfull \\hbox (141.633pt too wide)' });
    expect(countBySeverity(ds)).toEqual({ error: 4, warning: 4, info: 1 });
  });

  it('"!" 로 시작하는 오류(패키지 없음)는 뒤의 l.<줄> 로 위치를 채우고 "Emergency stop" 은 따로 세지 않는다', () => {
    expect(parseTexLog(fixture('xelatex-missing-package.log'))).toEqual([
      { severity: 'error', file: 'main.tex', line: 3, message: "LaTeX Error: File `nonexistentpkg.sty' not found." },
    ]);
  });

  it('패키지 경고의 이어지는 줄을 붙이고, 참고문헌 파일(main.bbl) 안의 경고는 그 파일로 찾는다', () => {
    const ds = parseTexLog(fixture('xelatex-warnings.log'));
    expect(ds).toContainEqual({
      severity: 'warning',
      file: 'main.tex',
      line: 5,
      message: "Package hyperref Warning: Token not allowed in a PDF string (Unicode): removing `math shift'",
    });
    expect(ds).toContainEqual({ severity: 'warning', file: 'main.tex', line: 7, message: 'Underfull \\hbox (badness 10000)' });
    // 참고문헌(main.bbl) 안에서 난 글꼴 경고
    expect(ds.find((d) => d.message.startsWith('LaTeX Font Warning: Font shape'))).toMatchObject({ file: 'main.bbl', line: 5 });
    // 같은 경고(줄 7의 Underfull 15번)는 한 번만
    expect(ds.filter((d) => d.message.startsWith('Underfull'))).toHaveLength(1);
    expect(ds.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('Biber .blg 의 경고를 읽는다', () => {
    expect(parseTexLog(fixture('biber-warning.blg'))).toEqual([{ severity: 'warning', file: null, line: null, message: "Biber: I didn't find a database entry for 'ghost' (section 0)" }]);
  });

  it('BibTeX .blg 의 경고를 읽는다', () => {
    expect(parseTexLog(fixture('bibtex-warning.blg'))).toEqual([{ severity: 'warning', file: null, line: null, message: 'BibTeX: I didn\'t find a database entry for "ghost"' }]);
  });
});

describe('LaTeX 로그 해석(만든 예)', () => {
  it('Biber 의 WARN·ERROR 를 읽는다', () => {
    const ds = parseTexLog('INFO - This is Biber 2.19\nWARN - I didn\'t find a database entry for \'x\'\nERROR - Cannot find \'refs.bib\'!\n');
    expect(ds.map((d) => d.severity)).toEqual(['warning', 'error']);
  });

  it('패키지 정보의 이어지는 줄("(foo)   …")에 있는 괄호는 세지 않는다', () => {
    // 실제 로그에서는 보통 앞줄의 "(" 와 짝이 맞지만, 짝이 안 맞는 줄이 오더라도 열린 파일(main.tex)을 잃지 않게 한다.
    const log = "(./main.tex\nPackage foo Info: note\n(foo)             closing paren only).\n\nLaTeX Warning: Reference `x' on page 1 undefined on input line 3.\n)";
    expect(parseTexLog(log)).toEqual([{ severity: 'warning', file: 'main.tex', line: 3, message: "LaTeX Warning: Reference `x' on page 1 undefined" }]);
  });

  it('한글 파일 이름과 폴더가 든 경로도 읽는다', () => {
    const ds = parseTexLog('(./main.tex (./장/서론.tex\n./장/서론.tex:7: Undefined control sequence.\n))');
    expect(ds).toEqual([{ severity: 'error', file: '장/서론.tex', line: 7, message: 'Undefined control sequence.' }]);
  });

  it('로그가 폭주해도 진단은 상한까지만 돌려준다', () => {
    const log = Array.from({ length: 1000 }, (_, i) => `./main.tex:${i + 1}: Undefined control sequence.`).join('\n');
    expect(parseTexLog(log)).toHaveLength(MAX_DIAGNOSTICS);
  });

  it('윈도 줄바꿈(\\r\\n)도 읽는다', () => {
    expect(parseTexLog('./a.tex:3: Missing $ inserted.\r\n')).toEqual([{ severity: 'error', file: 'a.tex', line: 3, message: 'Missing $ inserted.' }]);
  });
});
