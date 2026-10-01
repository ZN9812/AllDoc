import { describe, expect, it } from 'vitest';
import { baseName, extOf, isAiTarget, kindFromName } from './doc';

describe('파일 형식 판별', () => {
  it('확장자로 형식을 찾는다(대소문자 무시)', () => {
    expect(kindFromName('공문.HWP')).toBe('hwp');
    expect(kindFromName('보고서.hwpx')).toBe('hwpx');
    expect(kindFromName('계획서.DOCX')).toBe('docx');
    expect(kindFromName('참고.pdf')).toBe('pdf');
    expect(kindFromName('메모.txt')).toBe('txt');
    expect(kindFromName('README.markdown')).toBe('md');
  });

  it('지원하지 않는 형식과 확장자 없는 이름은 null', () => {
    expect(kindFromName('표.xlsx')).toBeNull();
    expect(kindFromName('발표.pptx')).toBeNull();
    expect(kindFromName('이름만')).toBeNull();
  });

  it('점이 여러 개인 이름에서도 마지막 확장자를 쓴다', () => {
    expect(extOf('a.b.c.docx')).toBe('docx');
    expect(baseName('a.b.c.docx')).toBe('a.b.c');
    expect(baseName('.hidden')).toBe('.hidden');
  });

  it('PDF 는 AI 대상이 아니다', () => {
    expect(isAiTarget('pdf')).toBe(false);
    expect(isAiTarget('hwp')).toBe(true);
  });
});
