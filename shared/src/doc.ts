// 파일 형식과 관련된 공통 정의

export const DOC_KINDS = ['hwp', 'hwpx', 'docx', 'pdf', 'txt', 'md'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const EXT_TO_KIND: Record<string, DocKind> = {
  hwp: 'hwp',
  hwpx: 'hwpx',
  docx: 'docx',
  pdf: 'pdf',
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
};

export const KIND_LABEL: Record<DocKind, string> = {
  hwp: 'HWP',
  hwpx: 'HWPX',
  docx: 'DOCX',
  pdf: 'PDF',
  txt: 'TXT',
  md: 'MD',
};

export const KIND_MIME: Record<DocKind, string> = {
  hwp: 'application/x-hwp',
  hwpx: 'application/vnd.hancom.hwpx',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
};

/** <input type="file" accept="..."> 에 넣는 값 */
export const ACCEPT_ATTR = '.hwp,.hwpx,.docx,.pdf,.txt,.md,.markdown';

/** 브라우저에서 한 파일로 받아들이는 최대 크기 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

export function kindFromName(fileName: string): DocKind | null {
  return EXT_TO_KIND[extOf(fileName)] ?? null;
}

/** 확장자를 뺀 이름 */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? fileName : fileName.slice(0, dot);
}

/** 문서를 글로 읽을 수 있는 형식인지(AI 대상) */
export function isAiTarget(kind: DocKind): boolean {
  return kind !== 'pdf';
}

/** 내용을 고칠 수 있는 형식인지 */
export function isEditable(kind: DocKind): boolean {
  return kind !== 'pdf';
}

/** 글꼴·크기 같은 서식을 읽고 고칠 수 있는 형식인지(서식 점검과 서식 변경 제안의 대상) */
export function isFormatKind(kind: DocKind): boolean {
  return kind === 'hwp' || kind === 'hwpx' || kind === 'docx';
}
