// Word 편집기(SuperDoc) 도구줄 설정: 쓰지 않는 도구는 숨기고, 이름은 한국어로 바꾼다.
import type { ToolbarItemId, ToolbarStringId } from 'superdoc';

/**
 * 숨기는 도구.
 * - 변경 추적 수락·거부, 문서 모드(검토·보기 전환): 이번 버전의 범위 밖
 * - 눈금자, 단위: 서식 점검과 겹치고 영문 단위(in)가 표시된다
 * - 확대/축소: 화면 너비에 맞춰 자동으로 줄여 보여 주므로(100%를 넘기지 않는다) 따로 두지 않는다.
 *   더 크게 보려면 브라우저 확대(Ctrl +)를 쓴다. SuperDoc 의 확대는 쪽의 왼쪽이 화면 밖으로 밀려 스크롤로도 볼 수 없게 된다.
 * - ai: SuperDoc 자체의 AI 단추. 이 앱의 AI 도우미만 쓴다
 */
export const TOOLBAR_EXCLUDE: readonly ToolbarItemId[] = [
  'track-changes-accept-selection',
  'track-changes-reject-selection',
  'document-mode',
  'ruler',
  'measurement-unit',
  'zoom',
  'ai',
];

export const TOOLBAR_STRINGS: Readonly<Partial<Record<ToolbarStringId, string>>> = {
  undo: '실행 취소',
  redo: '다시 실행',
  search: '찾기',
  zoom: '확대/축소',
  'font-family': '글꼴',
  'font-size': '글자 크기',
  bold: '굵게',
  italic: '기울임',
  underline: '밑줄',
  strikethrough: '취소선',
  'text-color': '글자 색',
  'highlight-color': '형광펜',
  link: '링크',
  image: '그림',
  table: '표 넣기',
  'table-actions': '표 편집',
  'insert-row-before': '위에 행 넣기',
  'insert-row-after': '아래에 행 넣기',
  'insert-column-before': '왼쪽에 열 넣기',
  'insert-column-after': '오른쪽에 열 넣기',
  'delete-row': '행 지우기',
  'delete-column': '열 지우기',
  'delete-table': '표 지우기',
  'merge-cells': '셀 합치기',
  'split-cell': '셀 나누기',
  'remove-borders': '테두리 없애기',
  'text-align': '정렬',
  'bullet-list': '글머리 기호',
  'numbered-list': '번호 매기기',
  'indent-decrease': '내어쓰기',
  'indent-increase': '들여쓰기',
  'line-height': '줄 간격',
  'clear-formatting': '서식 지우기',
  'copy-format': '서식 복사',
  'formatting-marks': '서식 기호 보기',
};
