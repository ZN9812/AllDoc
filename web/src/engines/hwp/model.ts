// 한글(HWP·HWPX) 문서의 읽기와 변경. @rhwp/core(WASM)의 문서 객체를 감싸서 화면과 무관하게 동작한다.
//
// 문단 번호: 문서 순서로 센 "문단 칸"의 번호(0부터).
//   머리말(모든 구역)이 맨 앞에 오고, 그다음 본문 문단이 이어진다. 본문 문단 다음에는 그 문단에 놓인 표의 칸 안 문단(표 안의 표 포함)과
//   글상자 안 문단(표 칸 안·글상자 안에 놓인 글상자 포함), 그 문단에 달린 각주·미주 문단이 컨트롤 순서대로 이어지고, 꼬리말이 맨 끝에 온다.
//   머리말·꼬리말·각주가 없고 표·글상자도 없는 문서에서는 본문 문단 번호(구역을 이어 붙인 번호)와 같다.
//   그림 캡션(글 캡션이 달린 그림)과 표 캡션의 문단은 그 개체가 든 문단 다음에(표 캡션은 표 칸 문단들의 앞이나 뒤에, 표의 캡션 방향을 따라) 이어진다.
//   표 안에 달린 각주와, 머리말·꼬리말·각주 안의 글상자, 묶음(그리기) 개체 안의 글상자, 도형·묶음 개체의 캡션, 표 칸·글상자 안에 놓인 표의 캡션은 다루지 않는다.
//   표 안에 달린 각주는 코어가 그 위치를 가리키는 방법을 주지 않고, 글상자는 코어의 경로 함수가 그곳을 가리키지 못한다. 도형·묶음 개체의 캡션과 안쪽 표의 캡션도 코어에 닿는 길이 없다.
// 글상자: 코어는 글상자(사각형·타원·다각형·곡선 개체가 가진 글)를 표 칸과 같은 경로 함수(*InCellByPath)로 읽고 고치게 해 준다
//   (경로 한 단계 = 글상자를 가진 개체의 컨트롤 번호, 칸 번호 0, 글상자 안 문단 번호). 표와 글상자가 섞여 중첩된 경로도 같은 방식으로 가리킨다.
//   문단 서식은 코어에 경로 함수가 없어서 표 칸처럼 본문 문단에 바로 놓인 글상자(깊이 1)만 읽고 바꾼다.
// 캡션: 그림 캡션은 글상자처럼 경로 함수로(어느 깊이든), 표 캡션은 평평한 함수에 칸 번호 65534 를 넣어서(본문 문단에 바로 놓인 표만) 읽고 고친다.
//   캡션 문단의 "번호 넣기"(자동 번호)는 코어가 위치 정보 없이 공백 한 글자로만 보여 준다. 그 자리를 글의 모양으로 어림해(captionNumberZone) 표지(№)로 바꿔
//   AI 에게 보여 주고, 그 자리를 건드리는 변경은 거절한다.
// 글자 위치: 코어는 유니코드 "글자"(코드 포인트) 단위로 센다. 자바스크립트 문자열 위치(UTF-16)와 다를 수 있어 바꿔서 쓴다.
import {
  textGuard,
  type Align,
  type AreaPlace,
  type CellPlace,
  type CharStyle,
  type DocSummary,
  type Op,
  type ParagraphInfo,
  type ParaStyle,
} from '@alldoc/shared';
import { applyAtomic, stale, unsupported, type OneResult } from '../applyOps';
import type { ApplyFailure, ApplyResult } from '../types';

/** 코어 문서 객체 중 이 모듈이 쓰는 부분만 좁혀 둔 약속(시험에서는 진짜 코어를, 화면에서는 브라우저의 코어를 끼운다). */
export interface HwpDocLike {
  getSectionCount(): number;
  getParagraphCount(section: number): number;
  getParagraphLength(section: number, para: number): number;
  getTextRange(section: number, para: number, offset: number, count: number): string;
  getCharPropertiesAt(section: number, para: number, offset: number): string;
  getParaPropertiesAt(section: number, para: number): string;
  insertText(section: number, para: number, offset: number, text: string): string;
  replaceText(section: number, para: number, offset: number, length: number, text: string): string;
  applyCharFormat(section: number, para: number, start: number, end: number, propsJson: string): string;
  applyParaFormat(section: number, para: number, propsJson: string): string;
  findOrCreateFontId(name: string): number;
  findOrCreateFontIdForLang(lang: number, name: string): number;
  pageCount(): number;
  exportHwpWithReport(): ExportReportLike;
  exportHwpxWithReport(): ExportReportLike;

  // 표: 본문 문단에 놓인 표는 (구역, 문단, 컨트롤 번호)로, 표 안의 표까지는 경로(JSON)로 가리킨다.
  // 경로는 `[{"controlIndex","cellIndex","cellParaIndex"}, …]` 이고 마지막 단계의 cellParaIndex 가 가리키는 문단이 대상이다.
  getControlTextPositions(section: number, para: number): string;
  getTableDimensions(section: number, parentPara: number, control: number): string;
  getTableDimensionsByPath(section: number, parentPara: number, pathJson: string): string;
  getCellInfo(section: number, parentPara: number, control: number, cell: number): string;
  getCellInfoByPath(section: number, parentPara: number, pathJson: string): string;
  getCellParagraphCountByPath(section: number, parentPara: number, pathJson: string): number;
  getCellParagraphLengthByPath(section: number, parentPara: number, pathJson: string): number;
  getTextInCellByPath(section: number, parentPara: number, pathJson: string, offset: number, count: number): string;
  getCellCharPropertiesAtByPath(section: number, parentPara: number, pathJson: string, offset: number): string;
  insertTextInCellByPath(section: number, parentPara: number, pathJson: string, offset: number, text: string): string;
  deleteTextInCellByPath(section: number, parentPara: number, pathJson: string, offset: number, count: number): string;
  applyCharFormatInCellByPath(section: number, parentPara: number, pathJson: string, start: number, end: number, propsJson: string): string;
  setCharShapeIdInCellByPath(section: number, parentPara: number, pathJson: string, start: number, end: number, charShapeId: number): string;
  // 평평한 함수(본문 문단에 놓인 개체의 칸 하나를 (구역, 문단, 컨트롤, 칸 번호, 칸 안 문단)으로 가리킨다). 표 캡션은 칸 번호 65534 로만 닿는다.
  getCellParagraphCount(section: number, parentPara: number, control: number, cell: number): number;
  getCellParagraphLength(section: number, parentPara: number, control: number, cell: number, cellPara: number): number;
  getTextInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, offset: number, count: number): string;
  insertTextInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, offset: number, text: string): string;
  deleteTextInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, offset: number, count: number): string;
  getCellCharPropertiesAt(section: number, parentPara: number, control: number, cell: number, cellPara: number, offset: number): string;
  applyCharFormatInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, start: number, end: number, propsJson: string): string;
  setCharShapeIdInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, start: number, end: number, charShapeId: number): string;
  getTableProperties(section: number, parentPara: number, control: number): string;
  // 문단 서식은 코어가 경로 기반 함수를 주지 않아서, 본문에 놓인 표(깊이 1)의 칸과 본문에 놓인 글상자·그림 캡션(깊이 1, 칸 번호 0)과 표 캡션(칸 번호 65534)만 읽고 바꿀 수 있다.
  getCellParaPropertiesAt(section: number, parentPara: number, control: number, cell: number, cellPara: number): string;
  applyParaFormatInCell(section: number, parentPara: number, control: number, cell: number, cellPara: number, propsJson: string): string;

  // 개체 하나를 내부 복사 칸에 복사하고 그 갈래를 이름("[표]", "[그림]", "[도형]")으로 알려 준다. 개체가 도형인지 그림인지 가리는 데 쓴다.
  // 글 캡션이 달린 그림도 글상자처럼 경로 함수로 문단이 읽혀서, 글상자로 세기 전에 도형인지 그림인지를 따로 확인해야 한다.
  // 개체가 든 문단은 본문이면 빈 경로("")로, 표 칸·글상자 안이면 그 문단까지의 경로(JSON)로 가리키고, 어느 쪽이든 따라간다.
  // (복사 칸은 이 문서 객체 안에만 있다. 우리는 붙여넣지 않고, 편집기 화면은 자기 문서 객체를 따로 가진다.)
  // 경로 방식 도형 속성 조회(getCellShapePropertiesByPath)는 쓰지 못한다: 그 문단이 표 칸일 때만 따라가고 글상자 안 문단은 따라가지 못한다.
  copyControl(section: number, para: number, cellPathJson: string, control: number): string;

  // 머리말·꼬리말: (구역, 머리말인지, 적용 쪽(0 양쪽, 1 짝수 쪽, 2 홀수 쪽), 그 안의 문단 번호)로 가리킨다.
  getHeaderFooterList(currentSection: number, currentIsHeader: boolean, currentApplyTo: number): string;
  getHeaderFooter(section: number, isHeader: boolean, applyTo: number): string;
  getHeaderFooterParaInfo(section: number, isHeader: boolean, applyTo: number, hfPara: number): string;
  getCharPropertiesInHeaderFooter(section: number, isHeader: boolean, applyTo: number, hfPara: number, offset: number): string;
  getParaPropertiesInHf(section: number, isHeader: boolean, applyTo: number, hfPara: number): string;
  insertTextInHeaderFooter(section: number, isHeader: boolean, applyTo: number, hfPara: number, offset: number, text: string): string;
  deleteTextInHeaderFooter(section: number, isHeader: boolean, applyTo: number, hfPara: number, offset: number, count: number): string;
  applyCharFormatInHeaderFooter(section: number, isHeader: boolean, applyTo: number, startPara: number, startOffset: number, endPara: number, endOffset: number, propsJson: string): string;
  applyParaFormatInHf(section: number, isHeader: boolean, applyTo: number, hfPara: number, propsJson: string): string;

  // 각주·미주: 본문에 놓인 것만 (구역, 그것을 단 본문 문단, 그 문단 안 컨트롤 번호, 각주 안 문단 번호)로 가리킬 수 있다.
  // 코어에는 각주 안 글자 서식을 읽고 쓰는 함수가 없어서, 글 바꾸기와 문단 서식만 된다.
  getFootnoteInfo(section: number, para: number, control: number): string;
  getParaPropertiesInFootnote(section: number, para: number, control: number, fnPara: number): string;
  insertTextInFootnote(section: number, para: number, control: number, fnPara: number, offset: number, text: string): string;
  deleteTextInFootnote(section: number, para: number, control: number, fnPara: number, offset: number, count: number): string;
  applyParaFormatInFootnote(section: number, para: number, control: number, fnPara: number, propsJson: string): string;

  /**
   * 문서 안 컨트롤의 목록(문단 번호는 구역을 이어 붙인 번호). 본문 문단에 놓인 각주·미주를 찾는 데 쓴다.
   * 표 칸·글상자 안의 컨트롤은 구역이 둘 이상인 문서에서 빠져서(둘째 구역부터의 안쪽 목록을 찾지 못한다. 실제 예제 문서에서 확인했다) 믿을 수 없다.
   * 그래서 표 안의 표·글상자를 찾는 데는 쓰지 않고, 모든 표 칸·글상자 문단을 직접 살핀다.
   */
  getControls?(): string;
  /** 묶음 모드: 그 사이의 변경은 쪽 나누기 계산을 건너뛰고, 끝낼 때 한 번만 한다(큰 문서에서 수백 배 빠르다). */
  beginBatch?(): string;
  endBatch?(): string;
}

export interface ExportReportLike {
  contentLoss(): string;
  takeBytes(): Uint8Array;
  free(): void;
}

export type HwpFormat = 'hwp' | 'hwpx';

/** 표 안으로 한 단계 들어가는 길: 문단 안의 컨트롤(표) 번호, 그 표의 칸 번호, 칸 안의 문단 번호 */
export interface CellStep {
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

interface BodySlot {
  kind: 'body';
  sec: number;
  para: number;
}

/** 표 칸·글상자 안 문단 칸이 함께 가진 것: 코어의 경로 함수로 읽고 고친다. */
interface PathSlotBase {
  sec: number;
  /** 가장 바깥 표·글상자가 놓인 본문 문단(구역 안 번호) */
  host: number;
  path: CellStep[];
  /** path 를 JSON 으로 만든 것(코어에 넘기는 값이라 한 번만 만든다) */
  pathJson: string;
  /** 이 문단이 든 가장 바깥 표(글상자)에 있는 문단의 수(안쪽 표·글상자 포함). 편집기가 이동하는 데 걸리는 시간을 가늠하는 데 쓴다. */
  tableWeight: number;
}

/** 표 칸 안의 문단(글상자 안의 표 칸은 아래 BoxSlot 이다) */
interface CellSlot extends PathSlotBase {
  kind: 'cell';
  place: CellPlace;
}

/**
 * 글상자 안의 문단. 글상자가 표 칸 안이나 다른 글상자 안에 놓였어도, 글상자 안에 놓인 표의 칸이어도 같다(위치는 가장 안쪽 글상자의 번호로만 말한다).
 * 글상자 번호는 문서 순서로 센다(글이 없는 글상자도 센다).
 */
interface BoxSlot extends PathSlotBase {
  kind: 'box';
  place: AreaPlace;
  /** 가장 안쪽 목록이 글상자인가(아니면 글상자 안에 놓인 표의 칸이다) */
  innerIsBox: boolean;
}

/**
 * 그림·표 캡션 안의 문단. 그림 캡션은 글상자처럼 경로로 읽고(그림이 표 칸·글상자 안에 놓여도 같다), 표 캡션은 칸 번호 65534 를 쓰는 평평한 함수로 읽는다
 * (본문 문단에 바로 놓인 표만. 이때 path 는 [{표 컨트롤 번호, 65534, 캡션 문단 번호}] 한 단계이고 경로 함수는 쓰지 못한다).
 * 번호는 그림 캡션이면 "캡션이 달린 그림"을 문서 순서로 센 번호, 표 캡션이면 표 번호(표 칸 위치 문구와 같은 번호)다.
 */
interface CaptionSlot extends PathSlotBase {
  kind: 'caption';
  place: AreaPlace;
  /** 표 캡션인가(아니면 그림 캡션) */
  isTable: boolean;
}

type PathSlot = CellSlot | BoxSlot | CaptionSlot;

/** 머리말·꼬리말 안의 문단 */
interface HfSlot {
  kind: 'hf';
  sec: number;
  isHeader: boolean;
  /** 적용 쪽: 0 양쪽, 1 짝수 쪽, 2 홀수 쪽 */
  applyTo: number;
  /** 머리말·꼬리말 안의 문단 번호 */
  para: number;
  /** 이 머리말·꼬리말을 정의한 본문 문단(구역 안 번호). 편집기가 이 문단으로만 이동할 수 있어 "문서에서 보기"에 쓴다. */
  host: number;
  place: AreaPlace;
}

/** 각주·미주 안의 문단 */
interface NoteSlot {
  kind: 'note';
  sec: number;
  /** 이 각주를 단 본문 문단(구역 안 번호) */
  host: number;
  /** 그 문단 안에서 각주 컨트롤의 번호 */
  control: number;
  /** 각주 안의 문단 번호 */
  para: number;
  place: AreaPlace;
}

type Slot = BodySlot | CellSlot | BoxSlot | CaptionSlot | HfSlot | NoteSlot;

/**
 * 코어가 돌려주는 JSON 중 getFootnoteInfo 는 글 속의 탭·줄바꿈 같은 제어 문자를 이스케이프하지 않는다(실제 예제 문서에서 확인했다).
 * JSON 은 문자열 안의 제어 문자를 허용하지 않아서 그대로는 읽히지 않으므로, 제어 문자를 \uXXXX 로 바꿔서 읽는다.
 * 코어의 JSON 은 토큰 사이에 공백이 없어서 제어 문자는 모두 문자열 안에 있다.
 */
const parseCoreJson = (raw: string): unknown => JSON.parse(raw.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));

/** 표 칸·글상자·캡션 안 문단 칸인가(코어의 칸 함수로 읽고 고친다) */
const isPathSlot = (slot: Slot): slot is PathSlot => slot.kind === 'cell' || slot.kind === 'box' || slot.kind === 'caption';

/** 코어가 표 캡션을 가리키는 칸 번호(TABLE_CAPTION_CELL_SENTINEL) */
const TABLE_CAPTION_CELL = 65534;

/** 캡션 문단의 번호 자리를 AI 에게 보여 주는 표지(공백 한 글자를 바꿔 넣으므로 글자 위치는 그대로다) */
export const CAPTION_NUMBER_MARK = '№';

/**
 * 캡션 문단의 "번호 넣기"(자동 번호) 자리를 글의 모양으로 어림한다.
 * 코어는 그 자리를 위치 정보 없이 글 속 공백 한 글자로만 보여 준다(내보낸 HWPX 의 XML 과 대조해 확인했다). 캡션 안 컨트롤의 위치를 알려 주는 함수는 없다.
 * 어림: 글이 공백으로 시작하지 않고 첫 공백 덩어리가 둘 이상이면, 그 덩어리의 둘째 글자가 번호 자리다
 * (실제 예제 문서의 번호 붙은 캡션 492개에서 모두 맞았다. "라벨 + 공백 + 번호 자리 + (공백) + 글" 모양이다).
 * 번호 자리 글자는 그 492개에서 모두 일반 공백(U+0020)이었다. 사람이 친 특수 공백(예: 숫자 폭 공백 U+2007)은 번호 자리가 아니므로 그 글자면 번호가 없다고 본다
 * (실제 예제 문서에 "Fig." + 공백 + U+2007 + "1." 꼴의 손으로 쓴 캡션이 있다).
 * 번호 없는 캡션에서 일반 공백을 연달아 쓴 곳이 번호 자리로 보일 수 있고(그 자리를 건드리는 변경이 거절될 뿐이다),
 * 코어가 새 캡션에 넣는 "그림  "처럼 번호 자리가 덩어리의 첫 글자일 때는 한 글자 어긋나지만, 덩어리 전체를 건드리지 않으므로 번호는 지켜진다.
 * 반환: 번호 자리 글자의 위치(at)와 그것이 든 첫 공백 덩어리의 [from, to) (자바스크립트 문자열 위치. 공백은 모두 한 칸이라 코어의 글자 위치와 같다). 번호가 없어 보이면 null.
 */
export function captionNumberZone(raw: string): { at: number; from: number; to: number } | null {
  if (/^\s/u.test(raw)) return null;
  const run = /\s+/u.exec(raw);
  if (!run || run[0].length < 2 || raw[run.index + 1] !== ' ') return null;
  return { at: run.index + 1, from: run.index, to: run.index + run[0].length };
}

/** raw 의 [start, end) 를 replacement 로 바꾸는 일이 번호 자리가 든 공백 덩어리를 건드리는가(덩어리 안을 바꾸거나, 덩어리 가장자리에 공백을 붙여 번호 자리를 어긋나게 하는 경우) */
function touchesCaptionNumber(zone: { from: number; to: number }, start: number, end: number, replacement: string): boolean {
  return (start < zone.to && end > zone.from) || (end === zone.from && /\s$/u.test(replacement)) || (start === zone.to && /^\s/u.test(replacement));
}

/**
 * 각주 첫 문단의 맨 앞 글자는 번호 자리(자동 번호)이고 코어는 그것을 공백 한 글자로 보여 준다. 그 글자는 지우거나 바꾸면 번호가 깨지므로
 * 우리가 읽는 글에서는 빼고 다룬다(바꿀 글의 위치에는 그만큼을 더해 코어에 넘긴다).
 */
const noteHidden = (slot: NoteSlot, full: string): number => (slot.para === 0 && /^\s/u.test(full) ? 1 : 0);

/** 머리말·꼬리말·각주 문단에서 바꾸면 안 되는 자리: 쪽 번호 같은 자동 항목이 글 사이에 든 자리(코어가 조절 문자로 보여 준다). */
const PROTECTED_CHARS = /[\u0000-\u0008\u000B-\u001F]/u;
const PROTECTED_CHARS_ALL = /[\u0000-\u0008\u000B-\u001F]/gu;

/** 편집기가 표 칸으로 이동할 때 받는 위치(편집기의 DocumentPosition 과 같은 모양) */
export interface CellFocus {
  position: {
    sectionIndex: number;
    paragraphIndex: number;
    charOffset: number;
    parentParaIndex: number;
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
    cellPath?: CellStep[];
    /** 가장 안쪽 목록이 글상자 */
    isTextBox?: boolean;
  };
  /** 선택할 글의 끝(없으면 캐럿만 놓는다) */
  end?: number;
  /** 가장 바깥 표가 너무 커서(MAX_FOCUS_TABLE_PARAGRAPHS) 칸으로 이동하면 화면이 오래 멈춘다. 이동하지 않는다. */
  tooBig?: boolean;
  /**
   * 캡션의 번호 때문에 고칠 글의 자리를 정확히 짚지 못해서, 선택하지 않고 번호 앞에 캐럿만 둔다(captionNumberZone 참고).
   * 코어는 캡션의 자동 번호를 글 속에 글자로 끼워 그려서, 편집기가 쓰는 글자 위치는 번호 뒤에서 번호의 글자 수(1 이상, 알 수 없다)만큼 어긋난다
   * (실제 편집기에서 확인했다: 번호 뒤의 글을 선택하면 한 글자 앞으로 밀려서 엉뚱한 글이 선택된다).
   */
  approximate?: boolean;
}

const ALIGNS: readonly string[] = ['left', 'center', 'right', 'justify'];

/** 탐색 안전장치: 이보다 깊거나 많은 표·문단은 따라가지 않는다(깨진 파일에서 끝없이 도는 것을 막는다). */
const MAX_TABLE_DEPTH = 8;
const MAX_SLOTS = 200_000;
/** 한 문단 안의 컨트롤을 이 수까지만 살핀다. */
const MAX_CONTROLS_PER_PARAGRAPH = 64;
/** 머리말·꼬리말 하나, 각주 하나가 담는 문단을 이 수까지만 읽는다. */
const MAX_AREA_PARAGRAPHS = 500;
/**
 * 편집기를 표 칸으로 이동시키는 데 걸리는 시간은 가장 바깥 표의 크기에 따라 크게 달라진다. 실제 문서 11개(표 하나당 문단 70개 이하)에서는
 * 글을 선택해도 3~22ms 였지만, 한 표에 문단이 1,588개 든 문서에서는 선택하면 칸 크기와 상관없이 약 13초, 캐럿만 옮겨도 칸에 따라 최대 8초가 걸렸다
 * (그동안 편집기와 우리 앱 화면이 모두 멈춘다). 그래서 가장 바깥 표의 문단이 이 수를 넘으면 칸으로 이동하지 않는다(그 표가 있는 곳으로 안내한다).
 */
export const MAX_FOCUS_TABLE_PARAGRAPHS = 250;
/** 코어가 "그 컨트롤은 표가 아니다"라고 알리는 오류 문구(표가 아닌 컨트롤 뒤에 표가 있을 수 있어 계속 살핀다). 다른 오류는 거기서 멈춘다. */
const NOT_A_TABLE = /표가 아닙니다|not a table/i;

/** 코어의 "글자" 수(코드 포인트) */
export const codePointLength = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

const toAlign = (raw: unknown): Align | undefined => (typeof raw === 'string' && ALIGNS.includes(raw) ? (raw as Align) : undefined);

interface CoreChar {
  fontFamily?: string;
  fontFamilies?: string[];
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** 글자 모양 번호. 글을 바꾼 뒤 원래 글자 모양을 그대로 되돌려 입히는 데 쓴다. */
  charShapeId?: number;
}

interface CorePara {
  alignment?: string;
  lineSpacing?: number;
  lineSpacingType?: string;
}

const failed = (message: string): ApplyFailure => ({ ok: false, reason: 'failed', message });
const ok = (raw: string): boolean => {
  try {
    return (JSON.parse(raw) as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
};

export interface ExportedBytes {
  bytes: Uint8Array;
  /** 내보낼 때 보존되지 않는 요소의 수(0 이면 손실 없음) */
  lossCount: number;
}

/** getControls() 가 돌려주는 컨트롤 하나(여기서 쓰는 것만) */
interface ControlEntry {
  ctrlId: string;
  /** 0 은 본문. 그 밖은 표 칸 같은 안쪽 목록의 번호 */
  list: number;
  /** 본문(list 0)이면 구역을 이어 붙인 문서 전체 문단 번호, 그 밖이면 그 목록 안 문단 번호 */
  para: number;
  controlIndex: number;
}

export class HwpModel {
  private slots: Slot[] | null = null;
  /** getControls() 를 한 번 읽은 결과(없거나 읽지 못하면 null) */
  private controlMemo: ControlEntry[] | null | undefined;
  /** 읽지 못한 각주·미주의 수(표 안에 달린 것은 코어가 위치를 가리키는 방법을 주지 않는다. 구역이 둘 이상인 문서에서는 표 안에 달린 것이 목록에서 빠져 이 수가 모자랄 수 있다) */
  private unreadableNotes = 0;
  /** 찾은 표(글상자 안의 표 포함)와 글상자(글이 없는 것 포함)의 수, 그중 본문 문단에 바로 놓인 글상자의 수, 읽은 그림 캡션·표 캡션(개체)의 수 */
  private found = { tables: 0, boxes: 0, bodyBoxes: 0, pictureCaptions: 0, tableCaptions: 0 };

  constructor(
    private readonly doc: HwpDocLike,
    readonly format: HwpFormat,
  ) {}

  // ───────────────────────── 문단 칸 열거 ─────────────────────────

  /** 문서 순서의 문단 칸 목록(처음 필요할 때 한 번 만든다. 글 바꾸기·서식 변경은 문단 수를 바꾸지 않으므로 그대로 쓴다). */
  private slotList(): Slot[] {
    this.slots ??= this.buildSlots();
    return this.slots;
  }

  /** 문서 안 모든 컨트롤의 목록을 한 번만 읽는다. 읽을 수 없으면 null. */
  private controls(): ControlEntry[] | null {
    if (this.controlMemo !== undefined) return this.controlMemo;
    this.controlMemo = null;
    if (!this.doc.getControls) return null;
    try {
      const raw = JSON.parse(this.doc.getControls()) as Array<Partial<ControlEntry>>;
      this.controlMemo = raw.flatMap((c) =>
        typeof c.ctrlId === 'string' && typeof c.list === 'number' && typeof c.para === 'number' && typeof c.controlIndex === 'number'
          ? [{ ctrlId: c.ctrlId.trim(), list: c.list, para: c.para, controlIndex: c.controlIndex }]
          : [],
      );
    } catch {
      this.controlMemo = null;
    }
    return this.controlMemo;
  }

  /** 문단(경로 paragraphPath, 본문 문단이면 빈 목록)에 든 컨트롤의 갈래 이름("[도형]", "[그림]", "[표]"). 알 수 없으면 빈 문자열. */
  private controlLabel(sec: number, host: number, paragraphPath: CellStep[], control: number): string {
    try {
      const r = JSON.parse(this.doc.copyControl(sec, host, paragraphPath.length === 0 ? '' : JSON.stringify(paragraphPath), control)) as { ok?: boolean; text?: string };
      return r.ok === true && typeof r.text === 'string' ? r.text : '';
    } catch {
      return '';
    }
  }

  /** 문단 칸 전체: 머리말, 본문(표 칸·각주 포함), 꼬리말 순서 */
  private buildSlots(): Slot[] {
    const body = this.buildBodySlots();
    const { headers, footers } = this.buildHeaderFooterSlots();
    return [...headers, ...body, ...footers];
  }

  /** 머리말·꼬리말 문단 칸. 구역 순서로, 같은 구역에서는 양쪽·홀수 쪽·짝수 쪽 순서로 센다. */
  private buildHeaderFooterSlots(): { headers: HfSlot[]; footers: HfSlot[] } {
    const out = { headers: [] as HfSlot[], footers: [] as HfSlot[] };
    let items: Array<{ sectionIdx: number; isHeader: boolean; applyTo: number }>;
    try {
      items = (JSON.parse(this.doc.getHeaderFooterList(0, true, 0)) as { items?: typeof items }).items ?? [];
    } catch {
      return out;
    }
    const pageOrder = [0, 2, 1];
    items = [...items].sort((a, b) => a.sectionIdx - b.sectionIdx || pageOrder.indexOf(a.applyTo) - pageOrder.indexOf(b.applyTo));
    const sections = this.doc.getSectionCount();
    for (const item of items) {
      let info: { exists?: boolean; paraCount?: number; paraIndex?: number };
      try {
        info = JSON.parse(this.doc.getHeaderFooter(item.sectionIdx, item.isHeader, item.applyTo)) as typeof info;
      } catch {
        continue;
      }
      if (!info.exists) continue;
      const pages = item.applyTo === 1 ? 'even' : item.applyTo === 2 ? 'odd' : 'both';
      const place: AreaPlace = { kind: item.isHeader ? 'header' : 'footer', pages, ...(sections > 1 ? { section: item.sectionIdx + 1 } : {}) };
      const target = item.isHeader ? out.headers : out.footers;
      for (let q = 0; q < Math.min(info.paraCount ?? 0, MAX_AREA_PARAGRAPHS); q++) {
        target.push({ kind: 'hf', sec: item.sectionIdx, isHeader: item.isHeader, applyTo: item.applyTo, para: q, host: info.paraIndex ?? 0, place });
      }
    }
    return out;
  }

  private buildBodySlots(): Slot[] {
    const doc = this.doc;
    const out: Slot[] = [];
    let tables = 0;
    let boxes = 0;
    let bodyBoxes = 0;
    let pictureCaptions = 0;
    let tableCaptions = 0;

    // 각주·미주는 getControls() 로 위치를 알아낸다(그 목록의 문단 번호는 구역을 이어 붙인 번호라서 구역·구역 안 번호로 바꾼다).
    const sections = doc.getSectionCount();
    const sectionStart: number[] = [];
    for (let s = 0, acc = 0; s < sections; s++) {
      sectionStart.push(acc);
      acc += doc.getParagraphCount(s);
    }
    const notesAt = new Map<string, 'footnote' | 'endnote'>();
    this.unreadableNotes = 0;
    for (const c of this.controls() ?? []) {
      if (c.ctrlId !== 'fn' && c.ctrlId !== 'en') continue;
      if (c.list !== 0) {
        this.unreadableNotes++;
        continue;
      }
      let s = sectionStart.length - 1;
      while (s > 0 && (sectionStart[s] as number) > c.para) s--;
      notesAt.set(`${s}:${c.para - (sectionStart[s] as number)}:${c.controlIndex}`, c.ctrlId === 'en' ? 'endnote' : 'footnote');
    }
    /** 이 각주·미주 안의 문단 칸을 담는다. */
    const pushNote = (sec: number, host: number, control: number, kind: 'footnote' | 'endnote'): void => {
      let info: { paraCount?: number; number?: number };
      try {
        info = parseCoreJson(doc.getFootnoteInfo(sec, host, control)) as typeof info;
      } catch {
        this.unreadableNotes++;
        return;
      }
      const place: AreaPlace = {
        kind,
        ...(typeof info.number === 'number' && info.number >= 1 ? { number: info.number } : {}),
        ...(sections > 1 ? { section: sec + 1 } : {}),
      };
      for (let q = 0; q < Math.min(info.paraCount ?? 0, MAX_AREA_PARAGRAPHS) && out.length < MAX_SLOTS; q++) out.push({ kind: 'note', sec, host, control, para: q, place });
    };

    const parse = <T>(raw: string): T => JSON.parse(raw) as T;

    /**
     * 본문 문단에 바로 놓인 표의 캡션 문단 칸(캡션이 없으면 null). 코어는 표 캡션을 칸 번호 65534 로만 가리키고 경로 함수는 닿지 못해서,
     * 표 안·글상자 안에 놓인 표의 캡션은 읽지 못한다. before 는 캡션이 표 위(또는 왼쪽)에 있는가: 그러면 표 칸 문단들보다 앞에 둔다.
     */
    const tableCaption = (sec: number, host: number, control: number, number: number): { slots: CaptionSlot[]; before: boolean } | null => {
      let count: number;
      try {
        count = doc.getCellParagraphCount(sec, host, control, TABLE_CAPTION_CELL);
      } catch {
        return null; // 캡션이 없는 표
      }
      if (!(count > 0)) return null;
      let before = false;
      try {
        // 캡션 방향: 0 왼쪽, 1 오른쪽, 2 위, 3 아래
        const direction = parse<{ captionDirection?: number }>(doc.getTableProperties(sec, host, control)).captionDirection;
        before = direction === 0 || direction === 2;
      } catch {
        // 방향을 몰라도 읽고 고치는 데는 영향이 없다(표 뒤에 둔다).
      }
      const place: AreaPlace = { kind: 'caption', of: 'table', number };
      const slots: CaptionSlot[] = [];
      for (let q = 0; q < Math.min(count, MAX_AREA_PARAGRAPHS); q++) {
        const path = [{ controlIndex: control, cellIndex: TABLE_CAPTION_CELL, cellParaIndex: q }];
        slots.push({ kind: 'caption', sec, host, path, pathJson: JSON.stringify(path), place, isTable: true, tableWeight: 0 });
      }
      tableCaptions++;
      return { slots, before };
    };

    /**
     * tablePath 의 마지막 단계(controlIndex)가 가리키는 표의 모든 칸 안 문단을 담는다. depth 1 은 본문에 놓인 표.
     * inBox 는 이 표가 든 가장 안쪽 글상자의 번호(글상자 안의 표면 그 칸 문단은 글상자 칸으로 담는다), 글상자 안이 아니면 null.
     */
    const visitTable = (sec: number, host: number, tablePath: CellStep[], depth: number, inBox: number | null): void => {
      if (depth > MAX_TABLE_DEPTH || out.length >= MAX_SLOTS) return;
      const last = tablePath[tablePath.length - 1] as CellStep;
      const base = tablePath.slice(0, -1);
      const number = ++tables;
      const caption = base.length === 0 ? tableCaption(sec, host, last.controlIndex, number) : null;
      if (caption?.before) out.push(...caption.slots);
      try {
        const dim = parse<{ cellCount: number }>(base.length === 0 ? doc.getTableDimensions(sec, host, last.controlIndex) : doc.getTableDimensionsByPath(sec, host, JSON.stringify(tablePath)));
        for (let k = 0; k < dim.cellCount; k++) {
          const cellRef = [...base, { controlIndex: last.controlIndex, cellIndex: k, cellParaIndex: 0 }];
          const info = parse<{ row: number; col: number }>(
            base.length === 0 ? doc.getCellInfo(sec, host, last.controlIndex, k) : doc.getCellInfoByPath(sec, host, JSON.stringify(cellRef)),
          );
          const count = doc.getCellParagraphCountByPath(sec, host, JSON.stringify(cellRef));
          for (let q = 0; q < count; q++) {
            if (out.length >= MAX_SLOTS) return;
            const path = [...base, { controlIndex: last.controlIndex, cellIndex: k, cellParaIndex: q }];
            const pathJson = JSON.stringify(path);
            out.push(
              inBox === null
                ? { kind: 'cell', sec, host, path, pathJson, place: { table: number, row: info.row + 1, col: info.col + 1, depth }, tableWeight: 0 }
                : { kind: 'box', sec, host, path, pathJson, place: { kind: 'textbox', number: inBox }, innerIsBox: false, tableWeight: 0 },
            );
            visitParagraphControls(sec, host, path, depth, inBox);
          }
        }
      } catch {
        // 읽을 수 없는 표는 건너뛴다(다른 표와 본문은 그대로 다룬다).
      }
      if (caption && !caption.before) out.push(...caption.slots);
    };

    /**
     * 문단(경로 paragraphPath, 본문 문단이면 빈 목록)에 든 컨트롤 j 가 글상자를 가진 도형이면 그 글상자 안 문단을 모두 담고,
     * 글 캡션이 달린 그림이면 그 캡션 문단을 모두 담는다. 그림은 글 캡션이 달리면 경로 함수로 문단이 읽혀서 글상자와 구별되지 않으므로, 갈래를 확인한다.
     */
    const visitBox = (sec: number, host: number, paragraphPath: CellStep[], j: number, depth: number): void => {
      if (depth > MAX_TABLE_DEPTH || out.length >= MAX_SLOTS) return;
      let count: number;
      try {
        count = doc.getCellParagraphCountByPath(sec, host, JSON.stringify([...paragraphPath, { controlIndex: j, cellIndex: 0, cellParaIndex: 0 }]));
      } catch {
        return; // 글상자가 아닌 컨트롤(그림·직선·묶음 등)
      }
      const label = this.controlLabel(sec, host, paragraphPath, j);
      if (label === '[그림]') {
        const number = ++pictureCaptions;
        const place: AreaPlace = { kind: 'caption', of: 'picture', number };
        for (let q = 0; q < Math.min(count, MAX_AREA_PARAGRAPHS) && out.length < MAX_SLOTS; q++) {
          const path = [...paragraphPath, { controlIndex: j, cellIndex: 0, cellParaIndex: q }];
          out.push({ kind: 'caption', sec, host, path, pathJson: JSON.stringify(path), place, isTable: false, tableWeight: 0 });
        }
        return;
      }
      if (label !== '[도형]') return;
      const number = ++boxes;
      if (paragraphPath.length === 0) bodyBoxes++;
      for (let q = 0; q < Math.min(count, MAX_AREA_PARAGRAPHS) && out.length < MAX_SLOTS; q++) {
        const path = [...paragraphPath, { controlIndex: j, cellIndex: 0, cellParaIndex: q }];
        out.push({ kind: 'box', sec, host, path, pathJson: JSON.stringify(path), place: { kind: 'textbox', number }, innerIsBox: true, tableWeight: 0 });
        visitParagraphControls(sec, host, path, depth, number);
      }
    };

    /** 표 칸·글상자 안 문단에 들어 있는 표(표 안의 표)와 글상자를 찾아 따라간다. */
    const visitParagraphControls = (sec: number, host: number, paragraphPath: CellStep[], depth: number, inBox: number | null): void => {
      for (let j = 0; j < MAX_CONTROLS_PER_PARAGRAPH; j++) {
        const probe = [...paragraphPath, { controlIndex: j, cellIndex: 0, cellParaIndex: 0 }];
        try {
          doc.getTableDimensionsByPath(sec, host, JSON.stringify(probe));
        } catch (e) {
          if (NOT_A_TABLE.test(e instanceof Error ? e.message : String(e))) {
            visitBox(sec, host, paragraphPath, j, depth + 1);
            continue;
          }
          return; // 더 이상 컨트롤이 없다("범위 초과") 또는 알 수 없는 오류
        }
        visitTable(sec, host, probe, depth + 1, inBox);
      }
    };

    for (let s = 0; s < doc.getSectionCount(); s++) {
      const count = doc.getParagraphCount(s);
      for (let p = 0; p < count; p++) {
        if (out.length >= MAX_SLOTS) return this.finishBodySlots(out, { tables, boxes, bodyBoxes, pictureCaptions, tableCaptions });
        out.push({ kind: 'body', sec: s, para: p });
        let positions: unknown;
        try {
          positions = parse<unknown>(doc.getControlTextPositions(s, p));
        } catch {
          continue;
        }
        if (!Array.isArray(positions)) continue;
        for (let c = 0; c < positions.length; c++) {
          const note = notesAt.get(`${s}:${p}:${c}`);
          if (note) {
            pushNote(s, p, c, note);
            continue;
          }
          const first = out.length;
          let isTable = true;
          try {
            doc.getTableDimensions(s, p, c);
          } catch {
            isTable = false; // 표가 아닌 컨트롤(구역 설정, 그림, 글상자 등)
          }
          if (isTable) visitTable(s, p, [{ controlIndex: c, cellIndex: 0, cellParaIndex: 0 }], 1, null);
          else visitBox(s, p, [], c, 1);
          // 이 표·글상자·그림 캡션(안쪽 표·글상자 포함)이 담은 문단 칸은 모두 방금 더해진 것들이다.
          for (let k = first; k < out.length; k++) (out[k] as PathSlot).tableWeight = out.length - first;
        }
      }
    }
    return this.finishBodySlots(out, { tables, boxes, bodyBoxes, pictureCaptions, tableCaptions });
  }

  private finishBodySlots(out: Slot[], found: HwpModel['found']): Slot[] {
    this.found = found;
    return out;
  }

  /**
   * 문서 구조의 크기(시험·진단용): 본문 문단 수, 표 칸 안 문단 수, 표 수(표 안의 표·글상자 안의 표 포함),
   * 글상자 수(글이 없는 글상자 포함)와 그중 본문 문단에 바로 놓인 수, 글상자 안 문단 수, 캡션 문단 수와 캡션이 달린 그림·표 수,
   * 머리말·꼬리말 문단 수, 각주·미주 문단 수, 읽지 못한 각주·미주 수
   */
  describeStructure(): {
    bodyParagraphs: number;
    cellParagraphs: number;
    tables: number;
    boxes: number;
    bodyBoxes: number;
    boxParagraphs: number;
    captionParagraphs: number;
    pictureCaptions: number;
    tableCaptions: number;
    headerFooterParagraphs: number;
    noteParagraphs: number;
    unreadableNotes: number;
  } {
    const list = this.slotList();
    const count = (kind: Slot['kind']): number => list.filter((s) => s.kind === kind).length;
    return {
      bodyParagraphs: count('body'),
      cellParagraphs: count('cell'),
      tables: this.found.tables,
      boxes: this.found.boxes,
      bodyBoxes: this.found.bodyBoxes,
      boxParagraphs: count('box'),
      captionParagraphs: count('caption'),
      pictureCaptions: this.found.pictureCaptions,
      tableCaptions: this.found.tableCaptions,
      headerFooterParagraphs: count('hf'),
      noteParagraphs: count('note'),
      unreadableNotes: this.unreadableNotes,
    };
  }

  private locate(index: number): Slot | null {
    const list = this.slotList();
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
    return list[index] ?? null;
  }

  /**
   * 편집기에서 이 문단으로 이동하는 데 쓰는 위치(구역, 구역 안 문단 번호, 글자 수).
   * 편집기의 공개 이동 수단은 본문 문단만 받아서, 표 안의 문단은 그 표가 놓인 본문 문단으로(inTable), 머리말·꼬리말·각주·미주·글상자·캡션 안의 문단은
   * 그것을 정의했거나 단 본문 문단으로(area) 안내한다.
   */
  paragraphTarget(index: number): { section: number; paragraph: number; length: number; inTable: boolean; area?: AreaPlace } | null {
    const slot = this.locate(index);
    if (!slot) return null;
    const para = slot.kind === 'body' ? slot.para : slot.host;
    try {
      return {
        section: slot.sec,
        paragraph: para,
        length: this.doc.getParagraphLength(slot.sec, para),
        inTable: slot.kind === 'cell',
        ...(slot.kind === 'hf' || slot.kind === 'note' || slot.kind === 'box' || slot.kind === 'caption' ? { area: slot.place } : {}),
      };
    } catch {
      return null;
    }
  }

  /**
   * 편집기를 이 문단(표 칸·글상자 안)으로 이동시키는 데 쓰는 위치. 본문 문단이면 null.
   * find 가 이 문단에 들어 있으면 그 글을 선택하도록 선택 끝(end)도 준다(위치와 길이는 코어의 글자 수 기준).
   * 위치 모양은 편집기의 DocumentPosition 과 같다: 평평한 칸 좌표는 가장 바깥 표·글상자 기준이고, 안쪽은 cellPath 에 전체 경로가 있다.
   * 가장 안쪽 목록이 글상자면 isTextBox 를 켠다(편집기가 글상자 안 위치를 가리키는 방식과 같다). 표 캡션은 칸 번호가 65534 다(편집기가 표 캡션을 가리키는 방식과 같다).
   */
  cellFocus(index: number, find?: string): CellFocus | null {
    const slot = this.locate(index);
    if (!slot || !isPathSlot(slot)) return null;
    const first = slot.path[0] as CellStep;
    let start = 0;
    let end: number | undefined;
    if (find) {
      const text = this.text(slot);
      const at = text.indexOf(find);
      if (at >= 0) {
        start = codePointLength(text.slice(0, at));
        end = start + codePointLength(find);
      }
    }
    let approximate = false;
    if (slot.kind === 'caption') {
      // 번호 앞의 글은 정확히 가리킬 수 있다. 번호 자리나 그 뒤의 글은 가리키지 못해서 번호 앞에 캐럿만 둔다.
      const raw = this.cellRaw(slot);
      const zone = captionNumberZone(raw);
      const numberAt = zone ? codePointLength(raw.slice(0, zone.at)) : 0; // 코어의 글자 위치(코드 포인트)로 바꾼다
      if (zone && end !== undefined && end > numberAt) {
        start = Math.min(start, numberAt);
        end = undefined;
        approximate = true;
      }
    }
    const tooBig = slot.tableWeight > MAX_FOCUS_TABLE_PARAGRAPHS;
    if (tooBig) end = undefined;
    return {
      position: {
        sectionIndex: slot.sec,
        paragraphIndex: slot.host,
        charOffset: start,
        parentParaIndex: slot.host,
        controlIndex: first.controlIndex,
        cellIndex: first.cellIndex,
        cellParaIndex: first.cellParaIndex,
        ...(slot.path.length > 1 ? { cellPath: slot.path.map((step) => ({ ...step })) } : {}),
        ...(slot.kind === 'box' && slot.innerIsBox ? { isTextBox: true } : {}),
      },
      ...(end !== undefined ? { end } : {}),
      ...(tooBig ? { tooBig: true } : {}),
      ...(approximate ? { approximate: true } : {}),
    };
  }

  // ───────────────────────── 문단 칸 읽기·쓰기(본문과 표 칸을 같은 방식으로) ─────────────────────────

  /** 각주·미주 안 문단들의 글(코어가 돌려주는 그대로: 첫 문단 맨 앞에 번호 자리가 공백으로 들어 있다) */
  private noteTexts(slot: NoteSlot): string[] {
    const info = parseCoreJson(this.doc.getFootnoteInfo(slot.sec, slot.host, slot.control)) as { texts?: unknown };
    return Array.isArray(info.texts) ? info.texts.map(String) : [];
  }

  private hfInfo(slot: HfSlot): { text: string; charCount: number } {
    const info = JSON.parse(this.doc.getHeaderFooterParaInfo(slot.sec, slot.isHeader, slot.applyTo, slot.para)) as { text?: string; charCount?: number };
    return { text: info.text ?? '', charCount: info.charCount ?? 0 };
  }

  private text(slot: Slot): string {
    switch (slot.kind) {
      case 'hf':
        return this.hfInfo(slot).text;
      case 'note': {
        const full = this.noteTexts(slot)[slot.para] ?? '';
        return full.slice(noteHidden(slot, full));
      }
      case 'body': {
        const len = this.doc.getParagraphLength(slot.sec, slot.para);
        return len <= 0 ? '' : this.doc.getTextRange(slot.sec, slot.para, 0, len);
      }
      case 'cell':
      case 'box':
        return this.cellRaw(slot);
      case 'caption': {
        // 번호 자리를 표지로 바꿔 보여 준다(글자 위치는 그대로).
        const raw = this.cellRaw(slot);
        const zone = captionNumberZone(raw);
        return zone ? raw.slice(0, zone.at) + CAPTION_NUMBER_MARK + raw.slice(zone.at + 1) : raw;
      }
    }
  }

  // 표 칸·글상자·캡션 문단 하나를 코어에서 읽고 고치는 함수들. 표 캡션만 칸 번호 65534 를 쓰는 평평한 함수로, 나머지는 경로 함수로 간다.

  /** 평평한 함수로 가야 하는 칸(표 캡션)이면 그 좌표, 아니면 null */
  private flatStep(slot: PathSlot): CellStep | null {
    return slot.kind === 'caption' && slot.isTable ? (slot.path[0] as CellStep) : null;
  }

  /** 칸 문단의 글(코어가 돌려주는 그대로) */
  private cellRaw(slot: PathSlot): string {
    const f = this.flatStep(slot);
    if (f) {
      const len = this.doc.getCellParagraphLength(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex);
      return len <= 0 ? '' : this.doc.getTextInCell(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex, 0, len);
    }
    const len = this.doc.getCellParagraphLengthByPath(slot.sec, slot.host, slot.pathJson);
    return len <= 0 ? '' : this.doc.getTextInCellByPath(slot.sec, slot.host, slot.pathJson, 0, len);
  }

  private cellCharAt(slot: PathSlot, offset: number): CoreChar {
    const f = this.flatStep(slot);
    const raw = f ? this.doc.getCellCharPropertiesAt(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex, offset) : this.doc.getCellCharPropertiesAtByPath(slot.sec, slot.host, slot.pathJson, offset);
    return JSON.parse(raw) as CoreChar;
  }

  private cellInsert(slot: PathSlot, offset: number, text: string): boolean {
    const f = this.flatStep(slot);
    return ok(f ? this.doc.insertTextInCell(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex, offset, text) : this.doc.insertTextInCellByPath(slot.sec, slot.host, slot.pathJson, offset, text));
  }

  private cellDelete(slot: PathSlot, offset: number, count: number): boolean {
    const f = this.flatStep(slot);
    return ok(f ? this.doc.deleteTextInCell(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex, offset, count) : this.doc.deleteTextInCellByPath(slot.sec, slot.host, slot.pathJson, offset, count));
  }

  private cellApplyChar(slot: PathSlot, start: number, end: number, propsJson: string): boolean {
    const f = this.flatStep(slot);
    return ok(f ? this.doc.applyCharFormatInCell(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex, start, end, propsJson) : this.doc.applyCharFormatInCellByPath(slot.sec, slot.host, slot.pathJson, start, end, propsJson));
  }

  private cellSetShape(slot: PathSlot, start: number, end: number, charShapeId: number): void {
    const f = this.flatStep(slot);
    if (f) this.doc.setCharShapeIdInCell(slot.sec, slot.host, f.controlIndex, f.cellIndex, f.cellParaIndex, start, end, charShapeId);
    else this.doc.setCharShapeIdInCellByPath(slot.sec, slot.host, slot.pathJson, start, end, charShapeId);
  }

  /** 글자 서식. 읽을 수 없는 곳(각주·미주 안)은 null. */
  private charProps(slot: Slot, offset = 0): CoreChar | null {
    switch (slot.kind) {
      case 'note':
        return null;
      case 'hf':
        return JSON.parse(this.doc.getCharPropertiesInHeaderFooter(slot.sec, slot.isHeader, slot.applyTo, slot.para, offset)) as CoreChar;
      case 'body':
        return JSON.parse(this.doc.getCharPropertiesAt(slot.sec, slot.para, offset)) as CoreChar;
      case 'cell':
      case 'box':
      case 'caption':
        return this.cellCharAt(slot, offset);
    }
  }

  /** 문단 서식. 읽을 수 없는 칸(표 안의 표, 표 칸·글상자 안에 놓인 글상자·그림의 캡션 등 깊이 2 이상)은 null. 표 캡션은 칸 번호 65534 로 읽는다. */
  private paraProps(slot: Slot): CorePara | null {
    switch (slot.kind) {
      case 'body':
        return JSON.parse(this.doc.getParaPropertiesAt(slot.sec, slot.para)) as CorePara;
      case 'hf':
        return JSON.parse(this.doc.getParaPropertiesInHf(slot.sec, slot.isHeader, slot.applyTo, slot.para)) as CorePara;
      case 'note':
        return JSON.parse(this.doc.getParaPropertiesInFootnote(slot.sec, slot.host, slot.control, slot.para)) as CorePara;
      case 'cell':
      case 'box':
      case 'caption': {
        if (slot.path.length > 1) return null;
        const step = slot.path[0] as CellStep;
        return JSON.parse(this.doc.getCellParaPropertiesAt(slot.sec, slot.host, step.controlIndex, step.cellIndex, step.cellParaIndex)) as CorePara;
      }
    }
  }

  private applyChar(slot: Slot, start: number, end: number, props: Record<string, unknown>): boolean {
    const json = JSON.stringify(props);
    switch (slot.kind) {
      case 'note':
        return false; // 코어에 각주 안 글자 서식을 바꾸는 함수가 없다.
      case 'hf':
        return ok(this.doc.applyCharFormatInHeaderFooter(slot.sec, slot.isHeader, slot.applyTo, slot.para, start, slot.para, end, json));
      case 'body':
        return ok(this.doc.applyCharFormat(slot.sec, slot.para, start, end, json));
      case 'cell':
      case 'box':
      case 'caption':
        return this.cellApplyChar(slot, start, end, json);
    }
  }

  private applyPara(slot: Slot, props: Record<string, unknown>): boolean {
    const json = JSON.stringify(props);
    switch (slot.kind) {
      case 'body':
        return ok(this.doc.applyParaFormat(slot.sec, slot.para, json));
      case 'hf':
        return ok(this.doc.applyParaFormatInHf(slot.sec, slot.isHeader, slot.applyTo, slot.para, json));
      case 'note':
        return ok(this.doc.applyParaFormatInFootnote(slot.sec, slot.host, slot.control, slot.para, json));
      case 'cell':
      case 'box':
      case 'caption': {
        const step = slot.path[0] as CellStep;
        return slot.path.length === 1 && ok(this.doc.applyParaFormatInCell(slot.sec, slot.host, step.controlIndex, step.cellIndex, step.cellParaIndex, json));
      }
    }
  }

  /** 머리말·꼬리말·각주 문단에 글을 끼워 넣는다(offset 은 우리가 읽는 글 기준). */
  private insertIn(slot: HfSlot | NoteSlot, offset: number, text: string): boolean {
    if (slot.kind === 'hf') return ok(this.doc.insertTextInHeaderFooter(slot.sec, slot.isHeader, slot.applyTo, slot.para, offset, text));
    return ok(this.doc.insertTextInFootnote(slot.sec, slot.host, slot.control, slot.para, offset + this.noteBase(slot), text));
  }

  private deleteIn(slot: HfSlot | NoteSlot, offset: number, count: number): boolean {
    if (slot.kind === 'hf') return ok(this.doc.deleteTextInHeaderFooter(slot.sec, slot.isHeader, slot.applyTo, slot.para, offset, count));
    return ok(this.doc.deleteTextInFootnote(slot.sec, slot.host, slot.control, slot.para, offset + this.noteBase(slot), count));
  }

  /** 각주 문단에서 우리가 읽는 글의 시작이 코어 글자 위치로 몇 번째인가(번호 자리를 빼므로 0 또는 1) */
  private noteBase(slot: NoteSlot): number {
    return noteHidden(slot, this.noteTexts(slot)[slot.para] ?? '');
  }

  /**
   * 글자 위치 start 부터 length 글자를 replacement 로 바꾼다(위치와 길이는 코어의 글자 수 기준).
   * 본문은 코어의 글 바꾸기를 쓰고, 표 칸·글상자·캡션은 코어에 글 바꾸기가 없어서 "새 글을 옛 글 바로 뒤에 넣고 옛 글을 지운다".
   * 이렇게 하면 새 글이 옛 글의 서식을 이어받는다. 옛 글 안에서 글자 모양이 갈린 경우를 위해, 바꾼 뒤에는 옛 글 첫 글자의 글자 모양을 새 글에 그대로 입힌다.
   * 머리말·꼬리말·각주는 코어의 글 바꾸기(머리말·꼬리말)가 새 글에 "바꾸는 글 바로 앞 글자"의 서식을 입혀서(굵은 낱말을 바꾸면 굵기가 사라진다) 쓰지 않고,
   * 새 글을 옛 글의 첫 글자 바로 뒤에 넣어 그 글자의 서식을 그대로 이어받게 한 뒤 옛 글(첫 글자와 나머지)을 지운다.
   */
  private replaceRange(slot: Slot, start: number, length: number, replacement: string): boolean {
    if (slot.kind === 'body') return ok(this.doc.replaceText(slot.sec, slot.para, start, length, replacement));
    if (slot.kind === 'hf' || slot.kind === 'note') return this.replaceInArea(slot, start, length, replacement);

    const added = codePointLength(replacement);
    const shapeBefore = length > 0 && added > 0 ? this.charProps(slot, start)?.charShapeId : undefined;
    if (added > 0 && !this.cellInsert(slot, start + length, replacement)) return false;
    if (length > 0 && !this.cellDelete(slot, start, length)) {
      // 새 글은 이미 들어갔다: 지워서 원래대로 돌려 놓는다.
      if (added > 0) this.cellDelete(slot, start + length, added);
      return false;
    }
    if (shapeBefore !== undefined && this.charProps(slot, start)?.charShapeId !== shapeBefore) {
      this.cellSetShape(slot, start, start + added, shapeBefore);
    }
    return true;
  }

  private replaceInArea(slot: HfSlot | NoteSlot, start: number, length: number, replacement: string): boolean {
    const added = codePointLength(replacement);
    if (length === 0) return added === 0 || this.insertIn(slot, start, replacement);
    if (added === 0) return this.deleteIn(slot, start, length);

    const old = [...this.text(slot)].slice(start, start + length).join('');
    // 1) 새 글을 옛 글의 첫 글자 바로 뒤에 넣는다(그 글자의 서식을 이어받는다).
    if (!this.insertIn(slot, start + 1, replacement)) return false;
    // 2) 옛 글의 나머지를 지운다.
    if (length > 1 && !this.deleteIn(slot, start + 1 + added, length - 1)) {
      this.deleteIn(slot, start + 1, added); // 새 글을 거둬 원래대로
      return false;
    }
    // 3) 옛 글의 첫 글자를 지운다.
    if (!this.deleteIn(slot, start, 1)) {
      // 나머지 옛 글을 새 글 뒤에 다시 넣고 새 글을 거둔다(서식은 앞 글자를 따른다. 이 경로는 코어가 지우기를 거절할 때만 탄다).
      if (length > 1) this.insertIn(slot, start + 1 + added, [...old].slice(1).join(''));
      this.deleteIn(slot, start + 1, added);
      return false;
    }
    return true;
  }

  // ───────────────────────── 요약 ─────────────────────────

  /** AI 와 서식 점검에 넘길 문서 요약. 글이 있는 문단만 담는다(번호는 건너뛰어도 문서 기준 번호를 그대로 쓴다). */
  summarize(): DocSummary {
    const paragraphs: ParagraphInfo[] = [];
    this.slotList().forEach((slot, index) => {
      const text = this.text(slot);
      if (text.trim().length === 0) return;
      // 쪽 번호 같은 자동 항목만 든 머리말·꼬리말 문단은 읽을 글이 없다.
      if ((slot.kind === 'hf' || slot.kind === 'note') && text.replace(PROTECTED_CHARS_ALL, '').trim().length === 0) return;
      const c = this.charProps(slot) ?? {};
      const pr = this.paraProps(slot) ?? {};
      const char: CharStyle = {};
      // 대표 글꼴은 한글(첫 칸)의 글꼴이다. 코어의 fontFamily 는 문단 첫 글자의 언어를 따라가서(숫자로 시작하면 영문 칸) 문단마다 달라질 수 있다.
      const family = c.fontFamilies?.[0] || c.fontFamily;
      if (family) char.fontFamily = family;
      if (typeof c.fontSize === 'number') char.fontSizePt = Math.round(c.fontSize) / 100;
      if (c.bold) char.bold = true;
      if (c.italic) char.italic = true;
      if (c.underline) char.underline = true;
      const para: ParaStyle = {};
      const align = toAlign(pr.alignment);
      if (align) para.align = align;
      if (pr.lineSpacingType === 'Percent' && typeof pr.lineSpacing === 'number') para.lineSpacingPct = Math.round(pr.lineSpacing);
      const info: ParagraphInfo = { index, text, char, para };
      if (slot.kind === 'cell') info.cell = slot.place;
      else if (slot.kind === 'hf' || slot.kind === 'note' || slot.kind === 'box' || slot.kind === 'caption') info.area = slot.place;
      paragraphs.push(info);
    });
    return { kind: this.format, paragraphs, pageCount: this.doc.pageCount() };
  }

  // ───────────────────────── 변경 ─────────────────────────

  /** 변경 묶음을 적용한다. 하나라도 실패하면 모두 되돌리고 실패를 돌려준다. */
  async apply(ops: Op[]): Promise<ApplyResult> {
    // 큰 문서에서는 변경마다 쪽 나누기를 다시 계산하면 한 건에 0.5초씩 걸린다(표가 큰 문서). 묶음 모드로 끝에 한 번만 계산한다.
    const batching = typeof this.doc.beginBatch === 'function' && typeof this.doc.endBatch === 'function';
    if (batching) this.doc.beginBatch?.();
    try {
      return await applyAtomic(async (op) => this.applyOne(op), ops);
    } finally {
      if (batching) {
        try {
          this.doc.endBatch?.();
        } catch {
          // 묶음을 끝내지 못해도 이미 한 변경은 그대로다. 다음 요청에서 다시 읽는다.
        }
      }
    }
  }

  private applyOne(op: Op): OneResult {
    const slot = this.locate(op.paragraph);
    if (!slot) return stale('문서가 바뀌어 해당 문단을 찾을 수 없어요.');
    const cur = this.text(slot);
    if (op.guard !== undefined && op.guard !== textGuard(cur)) return stale('문서가 바뀌어 이 제안을 적용할 수 없어요. 다시 점검해 주세요.');
    try {
      switch (op.type) {
        case 'replaceText':
          return this.replaceText(op, slot, cur);
        case 'setCharStyle':
          return this.setCharStyle(op, slot, cur);
        case 'setParaStyle':
          return this.setParaStyle(op, slot, cur);
      }
    } catch (e) {
      return failed(`한글 편집기에서 변경하지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private replaceText(op: Extract<Op, { type: 'replaceText' }>, slot: Slot, cur: string): OneResult {
    if (/[\r\n]/.test(op.replace)) return unsupported('줄바꿈이 들어간 변경은 아직 적용할 수 없어요.');
    if ((slot.kind === 'hf' || slot.kind === 'note') && (PROTECTED_CHARS.test(op.find) || PROTECTED_CHARS.test(op.replace))) {
      return unsupported('쪽 번호 같은 자동 항목이 든 글은 바꿀 수 없어요.');
    }

    let idx: number;
    if (op.find === '') {
      if (op.at === undefined || op.at > cur.length) return stale('끼워 넣을 위치를 찾을 수 없어요.');
      idx = op.at;
    } else if (op.at !== undefined && cur.startsWith(op.find, op.at)) {
      idx = op.at;
    } else {
      idx = cur.indexOf(op.find);
      if (idx < 0) return stale('문서가 바뀌어 고칠 글을 찾을 수 없어요.');
    }

    // 캡션은 표지(№)를 끼운 글이 아니라 코어의 글 그대로 비교해야 한다(번호 자리 어림이 바뀐 글에서 달라질 수 있다).
    const raw = slot.kind === 'caption' ? this.cellRaw(slot) : cur;
    if (slot.kind === 'caption') {
      const zone = captionNumberZone(raw);
      if (zone && touchesCaptionNumber(zone, idx, idx + op.find.length, op.replace)) {
        return unsupported('캡션의 번호(번호 넣기)가 든 자리와 그 둘레 공백은 바꿀 수 없어요. 라벨이나 뒤따르는 글만 바꿔 주세요.');
      }
    }

    const start = codePointLength(cur.slice(0, idx));
    const length = codePointLength(op.find);
    const expected = raw.slice(0, idx) + op.replace + raw.slice(idx + op.find.length);
    if (!this.replaceRange(slot, start, length, op.replace)) return failed('한글 편집기가 글을 바꾸지 못했어요.');

    const afterRaw = slot.kind === 'caption' ? this.cellRaw(slot) : this.text(slot);
    if (afterRaw !== expected) {
      // 코어가 예상과 다르게 바꿨다: 가능한 만큼 원래대로 돌려 놓고 실패로 알린다.
      this.replaceRange(slot, start, codePointLength(op.replace), op.find);
      return failed('한글 편집기가 글을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    const after = this.text(slot);
    return { ok: true, inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, at: idx, guard: textGuard(after) } };
  }

  private setCharStyle(op: Extract<Op, { type: 'setCharStyle' }>, slot: Slot, cur: string): OneResult {
    const len = codePointLength(cur);
    if (len === 0) return stale('빈 문단에는 서식을 바꿀 수 없어요.');
    const before = this.charProps(slot);
    if (!before) return unsupported('각주·미주 안의 글은 글자 서식(글꼴·크기·굵게 등)을 바꿀 수 없어요. 글 바꾸기와 문단 서식만 돼요.');
    const s = op.style;
    const props: Record<string, unknown> = {};
    const undo: CharStyle = {};

    if (s.fontFaces) {
      const ids = s.fontFaces.map((name, i) => this.doc.findOrCreateFontIdForLang(i, name));
      if (ids.some((id) => id < 0)) return failed('글꼴을 찾을 수 없어요.');
      props.fontIds = ids;
    } else if (s.fontFamily !== undefined) {
      // 글꼴 목록은 언어(한글·영문·한자·일어·기타·기호·사용자)마다 따로 있고, 같은 글꼴이어도 목록마다 번호가 다를 수 있다
      // (실제 문서에서는 대개 다르다). 그래서 번호 하나를 모든 언어에 쓰지 않고 언어마다 그 글꼴의 번호를 찾아 넣는다.
      const ids = Array.from({ length: 7 }, (_, lang) => this.doc.findOrCreateFontIdForLang(lang, s.fontFamily as string));
      if (ids.some((id) => id < 0)) return failed(`글꼴 "${s.fontFamily}"을(를) 쓸 수 없어요.`);
      props.fontIds = ids;
    }
    if (s.fontFaces || s.fontFamily !== undefined) {
      if (before.fontFamilies?.length === 7) undo.fontFaces = before.fontFamilies;
      else if (before.fontFamily) undo.fontFamily = before.fontFamily;
    }
    if (s.fontSizePt !== undefined) {
      props.fontSize = Math.round(s.fontSizePt * 100);
      if (typeof before.fontSize === 'number') undo.fontSizePt = before.fontSize / 100;
    }
    for (const key of ['bold', 'italic', 'underline'] as const) {
      if (s[key] !== undefined) {
        props[key] = s[key];
        undo[key] = Boolean(before[key]);
      }
    }
    if (Object.keys(props).length === 0) return failed('바꿀 서식이 없어요.');

    if (!this.applyChar(slot, 0, len, props)) return failed('한글 편집기가 글자 서식을 바꾸지 못했어요.');

    // 바뀐 결과를 다시 읽어 확인한다. 다르면 되돌리고 실패로 알린다.
    const after = this.charProps(slot) ?? {};
    const mismatch =
      (props.fontSize !== undefined && Math.round(after.fontSize ?? -1) !== props.fontSize) ||
      (s.fontFamily !== undefined && !s.fontFaces && (after.fontFamilies?.length === 7 ? after.fontFamilies.some((n) => n !== s.fontFamily) : after.fontFamily !== s.fontFamily)) ||
      (s.fontFaces !== undefined && JSON.stringify(after.fontFamilies) !== JSON.stringify(s.fontFaces)) ||
      (['bold', 'italic', 'underline'] as const).some((k) => s[k] !== undefined && Boolean(after[k]) !== s[k]);
    if (mismatch) {
      this.restoreChar(slot, len, undo);
      return failed('한글 편집기가 글자 서식을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'setCharStyle', paragraph: op.paragraph, style: undo, guard: textGuard(cur) } };
  }

  private restoreChar(slot: Slot, len: number, undo: CharStyle): void {
    const props: Record<string, unknown> = {};
    if (undo.fontFaces) props.fontIds = undo.fontFaces.map((n, i) => this.doc.findOrCreateFontIdForLang(i, n));
    else if (undo.fontFamily) props.fontId = this.doc.findOrCreateFontId(undo.fontFamily);
    if (undo.fontSizePt !== undefined) props.fontSize = Math.round(undo.fontSizePt * 100);
    for (const key of ['bold', 'italic', 'underline'] as const) if (undo[key] !== undefined) props[key] = undo[key];
    this.applyChar(slot, 0, len, props);
  }

  private setParaStyle(op: Extract<Op, { type: 'setParaStyle' }>, slot: Slot, cur: string): OneResult {
    const before = this.paraProps(slot);
    if (!before) {
      return unsupported(
        slot.kind === 'box'
          ? '표 칸이나 다른 글상자 안에 놓인 글상자(또는 글상자 안 표)의 문단은 정렬·줄 간격을 아직 바꿀 수 없어요.'
          : slot.kind === 'caption'
            ? '표 칸이나 글상자 안에 놓인 그림의 캡션은 정렬·줄 간격을 아직 바꿀 수 없어요.'
            : '표 안의 표에 있는 문단의 정렬·줄 간격은 아직 바꿀 수 없어요.',
      );
    }
    const s = op.style;
    const props: Record<string, unknown> = {};
    const undo: ParaStyle = {};

    const align = s.rawAlign ?? s.align;
    if (align !== undefined) {
      props.alignment = align;
      if (before.alignment) {
        undo.rawAlign = before.alignment;
        const a = toAlign(before.alignment);
        if (a) undo.align = a;
      }
    }
    if (s.rawLineSpacing !== undefined || s.lineSpacingPct !== undefined) {
      // 고정값·최소값 같은 방식은 값을 정확히 되돌릴 수 없어서 바꾸지 않는다.
      if (before.lineSpacingType !== 'Percent' || typeof before.lineSpacing !== 'number') {
        return unsupported('이 문단은 줄 간격이 퍼센트가 아닌 방식(고정값 등)이라 바꿀 수 없어요.');
      }
      const target = s.rawLineSpacing ? s.rawLineSpacing.value : (s.lineSpacingPct as number);
      props.lineSpacing = target;
      props.lineSpacingType = 'Percent';
      undo.lineSpacingPct = Math.round(before.lineSpacing);
      undo.rawLineSpacing = { type: 'Percent', value: before.lineSpacing };
    }
    if (Object.keys(props).length === 0) return failed('바꿀 서식이 없어요.');

    if (!this.applyPara(slot, props)) return failed('한글 편집기가 문단 서식을 바꾸지 못했어요.');

    const after = this.paraProps(slot) ?? {};
    const mismatch =
      (props.alignment !== undefined && after.alignment !== props.alignment) ||
      (props.lineSpacing !== undefined && Math.round(after.lineSpacing ?? -1) !== Math.round(props.lineSpacing as number));
    if (mismatch) {
      const restore: Record<string, unknown> = {};
      if (undo.rawAlign) restore.alignment = undo.rawAlign;
      if (undo.rawLineSpacing) {
        restore.lineSpacing = undo.rawLineSpacing.value;
        restore.lineSpacingType = undo.rawLineSpacing.type;
      }
      this.applyPara(slot, restore);
      return failed('한글 편집기가 문단 서식을 예상과 다르게 바꿔서 변경을 취소했어요.');
    }
    return { ok: true, inverse: { type: 'setParaStyle', paragraph: op.paragraph, style: undo, guard: textGuard(cur) } };
  }

  /** 지금 상태를 파일로 만든다. 손실이 있으면 lossCount 가 0 보다 크다. */
  exportBytes(): ExportedBytes {
    const out = this.format === 'hwpx' ? this.doc.exportHwpxWithReport() : this.doc.exportHwpWithReport();
    try {
      const report = JSON.parse(out.contentLoss()) as { count?: number };
      return { bytes: out.takeBytes(), lossCount: typeof report.count === 'number' ? report.count : 0 };
    } finally {
      out.free();
    }
  }
}
