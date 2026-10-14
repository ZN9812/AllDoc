// LaTeX 편집 화면의 컴파일 상태. 편집기(TexEngine)와 오른쪽 컴파일 탭(CompilePane)이 함께 본다.
import { create } from 'zustand';
import { countBySeverity, type CompileResponse, type TexDiagnostic } from '@alldoc/shared';

export type CompilePhase = 'idle' | 'uploading' | 'compiling' | 'done' | 'failed';

interface TexState {
  phase: CompilePhase;
  /** 컴파일을 시작한 시각(경과 시간 표시용) */
  startedAt: number | null;
  /** 올리는 중일 때 몇 개 중 몇 개 */
  upload: { done: number; total: number } | null;
  result: CompileResponse | null;
  /** 요청이 실패했을 때(서버·네트워크) 보여 줄 문장 */
  error: string | null;
  /** 마지막으로 성공한 PDF(다시 컴파일해 실패해도 남겨 둔다) */
  pdf: Uint8Array | null;
  /** 오류를 눌렀을 때 편집기가 열 곳. seq 는 같은 곳을 다시 눌러도 바뀌게 한다 */
  jump: { file: string; line: number; seq: number } | null;
  /** 편집기가 등록하는 "지금 컴파일" 함수(컴파일 탭의 단추가 부른다) */
  compile: (() => void) | null;
  /** "AI로 오류 고치기"를 부를 때의 오류 수. 그 뒤 컴파일에서 오류가 늘었는지 본다(docs/LATEX.md 느슨한 모드). */
  fixBaseline: number | null;
  /** 그때 올라온 오류 고치기 제안 */
  fixIds: string[];
  /** AI 제안을 적용한 뒤 오류가 늘었을 때의 안내 */
  regression: { before: number; after: number } | null;

  reset: () => void;
  start: () => void;
  setUpload: (done: number, total: number) => void;
  setCompiling: () => void;
  finish: (r: CompileResponse, pdf: Uint8Array | null) => void;
  fail: (message: string) => void;
  jumpTo: (file: string, line: number) => void;
  setCompile: (fn: (() => void) | null) => void;
  setFixBaseline: (n: number | null, ids?: string[]) => void;
  /** 컴파일이 끝난 뒤 부른다. 적용한 제안(appliedIds) 중에 오류 고치기 제안이 있으면 오류 수를 비교한다. */
  checkRegression: (appliedIds: string[]) => void;
}

let seq = 0;
const initial = {
  phase: 'idle' as CompilePhase,
  startedAt: null,
  upload: null,
  result: null,
  error: null,
  pdf: null,
  jump: null,
  compile: null,
  fixBaseline: null as number | null,
  fixIds: [] as string[],
  regression: null as { before: number; after: number } | null,
};

export const useTex = create<TexState>((set, get) => ({
  ...initial,
  reset: () => set({ ...initial }),
  start: () => set({ phase: 'uploading', startedAt: Date.now(), upload: null, error: null, regression: null }),
  setUpload: (done, total) => set({ upload: { done, total } }),
  setCompiling: () => set({ phase: 'compiling', upload: null }),
  finish: (result, pdf) => set((s) => ({ phase: 'done', result, pdf: pdf ?? s.pdf, startedAt: null, upload: null })),
  fail: (error) => set({ phase: 'failed', error, startedAt: null, upload: null }),
  jumpTo: (file, line) => set({ jump: { file, line, seq: ++seq } }),
  setCompile: (compile) => set({ compile }),
  setFixBaseline: (fixBaseline, ids = []) => set({ fixBaseline, fixIds: ids }),
  checkRegression: (appliedIds) => {
    const { fixBaseline, fixIds, result } = get();
    if (fixBaseline === null || !result || !fixIds.some((id) => appliedIds.includes(id))) return;
    const after = errorCount(result);
    set({ fixBaseline: null, fixIds: [], regression: after > fixBaseline ? { before: fixBaseline, after } : null });
  },
}));

/** 오류 수. 진단이 없어도 PDF를 못 만들었으면 1로 센다. */
export function errorCount(r: CompileResponse): number {
  const n = countBySeverity(r.diagnostics).error;
  return r.status === 'ok' ? n : Math.max(n, 1);
}

export const isBusy = (p: CompilePhase): boolean => p === 'uploading' || p === 'compiling';

/** 진단을 파일별로 나눈다(편집기의 줄 표시용) */
export function diagnosticsFor(ds: TexDiagnostic[], file: string): TexDiagnostic[] {
  return ds.filter((d) => d.file === file && d.line !== null);
}

/** 도구줄의 짧은 상태 문구 */
export function statusText(s: Pick<TexState, 'phase' | 'result' | 'error' | 'upload'>, elapsedSec: number): string {
  if (s.phase === 'uploading') return s.upload && s.upload.total > 0 ? `파일 올리는 중… ${s.upload.done}/${s.upload.total}` : `컴파일 준비 중… ${elapsedSec}초`;
  if (s.phase === 'compiling') return `컴파일 중… ${elapsedSec}초`;
  if (s.phase === 'failed') return '컴파일하지 못했어요';
  if (s.phase === 'done' && s.result) {
    const c = countBySeverity(s.result.diagnostics);
    if (s.result.status === 'timeout') return '시간 제한을 넘었어요';
    if (s.result.status === 'too_large') return 'PDF가 너무 커요';
    if (s.result.status === 'failed') return '컴파일하지 못했어요';
    if (c.error > 0) return `오류 ${c.error}`;
    if (s.result.status === 'error') return '오류';
    return c.warning > 0 ? `완료 · 경고 ${c.warning}` : '완료';
  }
  return '';
}
