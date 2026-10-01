import { describe, expect, it } from 'vitest';
import { describeLoadFailure } from './errors';

describe('describeLoadFailure', () => {
  it('ZIP 이 아닌 파일은 DOCX 가 아니거나 깨졌다고 알려 준다', () => {
    expect(describeLoadFailure({ diagnosticCode: 'PARSE_ERROR', diagnosticStage: 'unzip', internalCode: 'package-not-zip' })).toContain('Word(DOCX) 문서가 아니거나 깨져 있어요');
  });

  it('문서 원본을 준비하지 못한 경우는 원인 문장을 덧붙인다', () => {
    expect(describeLoadFailure({ code: 'source-load-failed', error: new Error('읽을 수 없음') })).toBe('이 문서를 열 수 없어요 (읽을 수 없음)');
    expect(describeLoadFailure({ code: 'source-load-failed' })).toBe('이 문서를 열 수 없어요');
  });

  it('문서 열기와 상관없는 알림은 무시한다', () => {
    expect(describeLoadFailure({ itemName: 'bold' })).toBeNull();
    expect(describeLoadFailure(undefined)).toBeNull();
  });
});
