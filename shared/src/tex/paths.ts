// LaTeX 프로젝트 안의 파일 경로 규칙. ZIP 가져오기(웹), 컴파일 요청 검사(서버), 작업 폴더에 쓰기(컴파일 일꾼)가 같은 규칙을 쓴다.

/** 한 프로젝트의 파일 수 상한 */
export const MAX_TEX_FILES = 1000;
/** 경로 전체 길이(글자 수)와 한 칸(폴더·파일 이름)의 길이(글자 수, 그리고 리눅스 이름 상한인 UTF-8 255바이트), 폴더 깊이 상한 */
export const MAX_PATH_CHARS = 240;
export const MAX_SEGMENT_CHARS = 120;
export const MAX_SEGMENT_BYTES = 255;
export const MAX_PATH_DEPTH = 12;

const utf8 = new TextEncoder();

/**
 * 프로젝트 안 상대 경로로 바꾼다. 쓸 수 없는 경로면 null.
 * 막는 것: 빈 경로, 절대 경로(/a, C:\a, \\server), "..", 제어 문자, 너무 긴 이름·깊은 폴더.
 * 역슬래시는 폴더 구분으로 보고, 이름은 NFC 로 맞춘다(macOS 에서 만든 ZIP 의 한글 이름은 NFD 일 수 있다).
 */
export function normalizeProjectPath(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let p = raw.normalize('NFC').replace(/\\/g, '/');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(p)) return null;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return null;
  while (p.startsWith('./')) p = p.slice(2);
  const segs = p.split('/');
  if (segs.length === 0 || segs.length > MAX_PATH_DEPTH) return null;
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return null;
    if (s.length > MAX_SEGMENT_CHARS || utf8.encode(s).length > MAX_SEGMENT_BYTES) return null;
    if (s.trim() !== s) return null;
  }
  const out = segs.join('/');
  return out.length > MAX_PATH_CHARS ? null : out;
}

/** latexmk 설정 파일(펄 코드라 셸 실행을 다시 켤 수 있다). 올릴 때 빼고 알린다. */
export function isLatexmkrc(path: string): boolean {
  const name = path.split('/').pop() ?? '';
  return name === 'latexmkrc' || name === '.latexmkrc';
}

export function isTexSource(path: string): boolean {
  return /\.(tex|ltx)$/i.test(path);
}

/** 원고 편집기로 여는 글 파일(나머지는 그림 등 이진 파일로 본다) */
export function isTextFile(path: string): boolean {
  return /\.(tex|ltx|bib|bst|cls|sty|bbx|cbx|lbx|def|cfg|clo|txt|md|csv|dat|tikz|pgf|lua)$/i.test(path);
}
