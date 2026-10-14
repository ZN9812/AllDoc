import { describe, expect, it } from 'vitest';
import { CompileRequestSchema } from './api';
import { isLatexmkrc, MAX_PATH_DEPTH, MAX_SEGMENT_CHARS, normalizeProjectPath } from './paths';

describe('프로젝트 파일 경로 검사', () => {
  it('상대 경로는 정리해서 받는다(역슬래시, 앞의 ./, NFD 한글)', () => {
    expect(normalizeProjectPath('main.tex')).toBe('main.tex');
    expect(normalizeProjectPath('./chapters/intro.tex')).toBe('chapters/intro.tex');
    expect(normalizeProjectPath('chapters\\intro.tex')).toBe('chapters/intro.tex');
    expect(normalizeProjectPath('장/서론 1.tex'.normalize('NFD'))).toBe('장/서론 1.tex');
  });

  it('밖으로 나가는 경로와 절대 경로는 막는다', () => {
    for (const p of ['../x.tex', 'a/../../x.tex', 'a/..', '/etc/passwd', 'C:\\x.tex', 'c:x', '\\\\server\\x', '', 'a//b', 'a/./b', '.']) {
      expect(normalizeProjectPath(p), p).toBeNull();
    }
  });

  it('제어 문자·앞뒤 공백·너무 긴 이름·깊은 폴더는 막는다', () => {
    expect(normalizeProjectPath('a\u0000.tex')).toBeNull();
    expect(normalizeProjectPath('a\n.tex')).toBeNull();
    expect(normalizeProjectPath(' a.tex')).toBeNull();
    expect(normalizeProjectPath(`${'가'.repeat(MAX_SEGMENT_CHARS + 1)}.tex`)).toBeNull();
    // 한글은 한 글자가 UTF-8 3바이트라 글자 수보다 255바이트 상한에 먼저 걸린다.
    expect(normalizeProjectPath(`${'가'.repeat(80)}.tex`)).not.toBeNull();
    expect(normalizeProjectPath(`${'가'.repeat(84)}.tex`)).toBeNull();
    expect(normalizeProjectPath(`${'a'.repeat(MAX_SEGMENT_CHARS - 4)}.tex`)).not.toBeNull();
    expect(normalizeProjectPath(`${Array(MAX_PATH_DEPTH).fill('d').join('/')}/x.tex`)).toBeNull();
  });

  it('latexmk 설정 파일을 알아본다', () => {
    expect(isLatexmkrc('latexmkrc')).toBe(true);
    expect(isLatexmkrc('sub/.latexmkrc')).toBe(true);
    expect(isLatexmkrc('latexmkrc.tex')).toBe(false);
  });

  it('컴파일 요청은 정리되지 않은 경로를 받지 않는다', () => {
    const file = { hash: 'a'.repeat(64), size: 1 };
    expect(CompileRequestSchema.safeParse({ engine: 'xelatex', main: 'main.tex', files: [{ path: 'main.tex', ...file }] }).success).toBe(true);
    expect(CompileRequestSchema.safeParse({ engine: 'xelatex', main: 'main.tex', files: [{ path: '../main.tex', ...file }] }).success).toBe(false);
    expect(CompileRequestSchema.safeParse({ engine: 'xelatex', main: './main.tex', files: [{ path: 'main.tex', ...file }] }).success).toBe(false);
    expect(CompileRequestSchema.safeParse({ engine: 'tectonic', main: 'main.tex', files: [{ path: 'main.tex', ...file }] }).success).toBe(false);
  });
});
