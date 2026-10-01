import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES } from '@alldoc/shared';
import { checkUpload, exportName, formatBytes } from './files';

describe('올린 파일 확인', () => {
  it('열 수 있는 형식은 종류를 알려 준다(대문자 확장자도)', () => {
    expect(checkUpload({ name: '보고서.hwp', size: 10 })).toEqual({ ok: true, kind: 'hwp' });
    expect(checkUpload({ name: '보고서.HWPX', size: 10 })).toEqual({ ok: true, kind: 'hwpx' });
    expect(checkUpload({ name: 'a.docx', size: 10 })).toEqual({ ok: true, kind: 'docx' });
    expect(checkUpload({ name: 'a.pdf', size: 10 })).toEqual({ ok: true, kind: 'pdf' });
    expect(checkUpload({ name: 'a.txt', size: 10 })).toEqual({ ok: true, kind: 'txt' });
    expect(checkUpload({ name: 'a.md', size: 10 })).toEqual({ ok: true, kind: 'md' });
  });

  it('지원하지 않는 형식은 이유를 한국어로 알려 준다', () => {
    for (const name of ['표.xlsx', '발표.pptx', '옛문서.doc']) {
      const r = checkUpload({ name, size: 10 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain('열 수 없어요');
    }
    const noExt = checkUpload({ name: 'README', size: 10 });
    expect(noExt.ok).toBe(false);
  });

  it('빈 파일과 너무 큰 파일은 거절한다', () => {
    expect(checkUpload({ name: 'a.txt', size: 0 })).toMatchObject({ ok: false });
    const big = checkUpload({ name: 'a.pdf', size: MAX_FILE_BYTES + 1 });
    expect(big.ok).toBe(false);
    expect(checkUpload({ name: 'a.pdf', size: MAX_FILE_BYTES })).toMatchObject({ ok: true });
  });
});

describe('내려받을 파일 이름', () => {
  it('고치지 않았으면 원래 이름 그대로', () => {
    expect(exportName('보고서.hwp', false)).toBe('보고서.hwp');
  });

  it('고쳤으면 이름 뒤에 _수정본을 붙여 원본과 구분한다', () => {
    expect(exportName('보고서.hwp', true)).toBe('보고서_수정본.hwp');
    expect(exportName('v1.2.final.docx', true)).toBe('v1.2.final_수정본.docx');
  });

  it('다른 형식으로 내보내면 확장자를 바꾼다', () => {
    expect(exportName('보고서.hwpx', true, 'pdf')).toBe('보고서_수정본.pdf');
    expect(exportName('보고서.hwpx', false, 'pdf')).toBe('보고서.pdf');
  });

  it('확장자가 없는 이름도 다룬다', () => {
    expect(exportName('메모', true, 'txt')).toBe('메모_수정본.txt');
  });
});

describe('파일 크기 표시', () => {
  it('단위를 알맞게 고른다', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5MB');
    expect(formatBytes(48 * 1024 * 1024)).toBe('48MB');
  });
});
