import type { DocKind, DocSummary, Op } from '@alldoc/shared';

/** 왼쪽 쪽 목록에 필요한 것. 엔진이 쪽을 알려 준다. */
export interface PagesApi {
  count: number;
  current: number;
  /** <img src> 에 넣을 주소(data: 또는 blob:). 못 만들면 null */
  thumb(index: number): Promise<string | null>;
  goTo(index: number): void;
}

export interface ExportOption {
  id: string;
  label: string;
  ext: string;
  run(): Promise<Blob>;
}

export type ApplyFailure = { ok: false; reason: 'stale' | 'unsupported' | 'failed'; message: string };
export type ApplyResult = { ok: true; inverse: Op[] } | ApplyFailure;

/** 문서 위에 "AI 가 고칠 곳"을 표시할 대상. find 가 있으면 그 글만, 없으면 문단 전체. */
export interface HighlightTarget {
  paragraph: number;
  find?: string;
}

export interface HighlightState {
  /** 아직 적용하지 않은 제안이 가리키는 곳(청록색으로 표시) */
  pending: HighlightTarget[];
  /** 지금 보고 있는 제안(카드에 마우스를 올린 것)이 가리키는 곳(더 진하게 표시) */
  focus: HighlightTarget[];
}

/** 편집기 연결부(엔진)가 화면 쪽에 내주는 손잡이 */
export interface EngineHandle {
  readonly kind: DocKind;
  /** 서식 변경(setCharStyle, setParaStyle)을 지원하는지 */
  readonly canFormat: boolean;
  /** 지금 상태를 원본 형식의 파일로 */
  getBlob(): Promise<Blob>;
  /** 내려받기 선택지(원본 형식 + 다른 형식) */
  exportOptions(): ExportOption[];
  /** AI 와 서식 점검에 넘길 문서 요약 */
  summarize(): Promise<DocSummary>;
  /** 변경을 한 묶음으로 적용한다. 하나라도 실패하면 모두 되돌리고 실패를 돌려준다. */
  apply(ops: Op[]): Promise<ApplyResult>;
  setHighlights(state: HighlightState): void;
}

export interface LoadedDoc {
  id: string;
  name: string;
  kind: DocKind;
  blob: Blob;
}

export interface EngineProps {
  doc: LoadedDoc;
  /** 도구줄 칸. 엔진이 자기 도구줄을 여기에 그린다. 비어 있으면 도구줄이 숨는다. */
  toolsHost: HTMLElement | null;
  onReady(handle: EngineHandle): void;
  /** 사용자가 문서를 고쳤을 때(자동 저장 신호) */
  onDirty(): void;
  onPages(pages: PagesApi | null): void;
  onError(message: string): void;
}
