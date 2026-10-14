// LaTeX 원고 편집기(CodeMirror 6, MIT). tex 문서를 열 때만 불러온다(engines/registry.ts).
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet } from '@codemirror/view';
import type { TexDiagnostic } from '@alldoc/shared';

export { EditorState, EditorView };

const texLanguage = StreamLanguage.define(stex);

/** 화면 색은 앱의 디자인 토큰을 따른다(밝은·어두운 테마 모두). */
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--paper)', color: 'var(--paper-ink)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK KR", monospace', lineHeight: '1.6' },
  '.cm-content': { padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: '#8792a8', borderRight: '1px solid #e3e8f0' },
  '.cm-activeLine': { backgroundColor: 'rgba(31, 95, 209, 0.06)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(31, 95, 209, 0.08)' },
  '&.cm-focused': { outline: 'none' },
  // AI 가 고칠 곳(두 테마 모두 청록색, docs/DESIGN.md)
  '.cm-ai': { backgroundColor: 'var(--paper-ai-bg)', color: 'var(--paper-ai-ink)', borderRadius: '2px' },
  '.cm-ai-focus': { backgroundColor: 'var(--paper-ai-bg)', color: 'var(--paper-ai-ink)', outline: '2px solid var(--ai)', borderRadius: '2px' },
});

export interface AiMark {
  from: number;
  to: number;
  focus: boolean;
}

const setAiMarks = StateEffect.define<AiMark[]>();

/** AI 제안이 가리키는 곳의 표시. 글이 바뀌면 표시도 따라 움직이고, 새 표시가 오면 바꾼다. */
const aiMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let v = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setAiMarks)) continue;
      const len = tr.state.doc.length;
      const ranges = e.value
        .filter((m) => m.from < m.to && m.to <= len)
        .sort((a, b) => a.from - b.from || a.to - b.to)
        .map((m) => Decoration.mark({ class: m.focus ? 'cm-ai-focus' : 'cm-ai' }).range(m.from, m.to));
      v = Decoration.set(ranges, true);
    }
    return v;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function showAiMarks(view: EditorView, marks: AiMark[]): void {
  view.dispatch({ effects: setAiMarks.of(marks) });
}

/** 그 범위를 고르고 화면 가운데로 스크롤한다. */
export function selectRange(view: EditorView, from: number, to: number): void {
  const len = view.state.doc.length;
  const a = Math.min(from, len);
  const b = Math.min(to, len);
  view.dispatch({ selection: EditorSelection.range(a, b), effects: EditorView.scrollIntoView(a, { y: 'center' }) });
  view.focus();
}

/** 지금 고른 곳의 줄 범위(1부터) */
export function selectedLines(state: EditorState): { from: number; to: number } {
  const r = state.selection.main;
  return { from: state.doc.lineAt(r.from).number, to: state.doc.lineAt(r.to).number };
}

export interface CmHooks {
  /** 글이 바뀔 때 */
  onChange(): void;
  /** Ctrl/Cmd+S, Ctrl/Cmd+Enter */
  onCompile(): void;
}

export function texExtensions(label: string, hooks: CmHooks): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    texLanguage,
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    EditorView.lineWrapping,
    lintGutter(),
    aiMarks,
    theme,
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          hooks.onCompile();
          return true;
        },
      },
      {
        key: 'Mod-Enter',
        preventDefault: true,
        run: () => {
          hooks.onCompile();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onChange();
    }),
  ];
}

/** 컴파일 진단을 줄 표시(lint)로 바꾼다. 줄 번호가 문서 밖이면 마지막 줄에 단다. */
export function showDiagnostics(view: EditorView, ds: TexDiagnostic[]): void {
  const doc = view.state.doc;
  const out: Diagnostic[] = [];
  for (const d of ds) {
    if (d.line === null) continue;
    const line = doc.line(Math.min(Math.max(1, d.line), doc.lines));
    out.push({ from: line.from, to: line.to, severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info', message: d.message });
  }
  view.dispatch(setDiagnostics(view.state, out));
}

/** 그 줄로 커서를 옮기고 화면 가운데로 스크롤한다. */
export function goToLine(view: EditorView, lineNo: number): void {
  const doc = view.state.doc;
  const line = doc.line(Math.min(Math.max(1, lineNo), doc.lines));
  view.dispatch({ selection: EditorSelection.cursor(line.from), effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
  view.focus();
}
