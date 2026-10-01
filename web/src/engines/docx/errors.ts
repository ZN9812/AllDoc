// Word 편집기(SuperDoc)의 오류 알림을 사용자가 알아들을 말로 바꾼다.

/** 문서를 여는 중에 난 SuperDoc 의 오류 알림에서, 사용자에게 보여 줄 안내 문장을 만든다. 열기와 상관없는 알림이면 null. */
export function describeLoadFailure(payload: unknown): string | null {
  const p = (payload ?? {}) as { code?: unknown; diagnosticCode?: unknown; internalCode?: unknown; error?: unknown };
  if (p.internalCode === 'package-not-zip') {
    return '이 파일은 Word(DOCX) 문서가 아니거나 깨져 있어요. 예전 형식(.doc)이라면 Word 에서 DOCX 로 저장한 뒤 올려 주세요.';
  }
  if (p.code === 'source-load-failed' || p.diagnosticCode === 'PARSE_ERROR') {
    const detail = p.error instanceof Error && p.error.message ? ` (${p.error.message})` : '';
    return `이 문서를 열 수 없어요${detail}`;
  }
  return null;
}
