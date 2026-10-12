// Word 편집기(SuperDoc 1.x) 도구줄 설정: 쓰지 않는 도구는 숨기고, 이름은 한국어로 바꾼다.
// 1.x 는 도구 id·문구 키의 타입을 내보내지 않아 문자열로 적는다(id 는 1.x 의 기본 도구 이름, 문구 키는 1.x 의 toolbarTexts 키).

/**
 * 숨기는 도구.
 * - 변경 추적 수락·거부, 문서 모드(검토·보기 전환): 이번 버전의 범위 밖
 * - 눈금자: 서식 점검과 겹치고 영문 단위(in)가 표시된다
 * - 확대/축소: 화면 너비에 맞춰 자동으로 줄여 보여 주므로(100%를 넘기지 않는다) 따로 두지 않는다.
 *   더 크게 보려면 브라우저 확대(Ctrl +)를 쓴다. SuperDoc 의 확대는 쪽의 왼쪽이 화면 밖으로 밀려 스크롤로도 볼 수 없게 된다.
 * - ai: SuperDoc 자체의 AI 단추. 이 앱의 AI 도우미만 쓴다
 */
export const TOOLBAR_EXCLUDE: readonly string[] = ['acceptTrackedChangeBySelection', 'rejectTrackedChangeOnSelection', 'documentMode', 'ruler', 'zoom', 'ai'];

export const TOOLBAR_STRINGS: Readonly<Record<string, string>> = {
  undo: '실행 취소',
  redo: '다시 실행',
  search: '찾기',
  zoom: '확대/축소',
  fontFamily: '글꼴',
  fontSize: '글자 크기',
  bold: '굵게',
  italic: '기울임',
  underline: '밑줄',
  strikethrough: '취소선',
  color: '글자 색',
  highlight: '형광펜',
  link: '링크',
  image: '그림',
  table: '표 넣기',
  tableActions: '표 편집',
  addRowBefore: '위에 행 넣기',
  addRowAfter: '아래에 행 넣기',
  addColumnBefore: '왼쪽에 열 넣기',
  addColumnAfter: '오른쪽에 열 넣기',
  deleteRow: '행 지우기',
  deleteColumn: '열 지우기',
  deleteTable: '표 지우기',
  mergeCells: '셀 합치기',
  splitCell: '셀 나누기',
  removeBorders: '테두리 없애기',
  textAlign: '정렬',
  bulletList: '글머리 기호',
  numberedList: '번호 매기기',
  indentLeft: '내어쓰기',
  indentRight: '들여쓰기',
  lineHeight: '줄 간격',
  clearFormatting: '서식 지우기',
  copyFormat: '서식 복사',
  formattingMarks: '서식 기호 보기',
};
