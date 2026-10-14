import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { DocKind } from '@alldoc/shared';
import ChangesPane from './ChangesPane';
import ChatPane from './ChatPane';
import CompilePane from './CompilePane';
import FormatPane from './FormatPane';
import { selectPendingCount, useEditor, type Tab } from './store';

const DOC_TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'AI 대화' },
  { id: 'format', label: '서식 점검' },
  { id: 'changes', label: '변경 내역' },
];
/** LaTeX 는 서식 점검 대신 컴파일 탭을 둔다(docs/LATEX.md) */
const TEX_TABS: Array<{ id: Tab; label: string }> = [
  { id: 'chat', label: 'AI 대화' },
  { id: 'compile', label: '컴파일' },
  { id: 'changes', label: '변경 내역' },
];

export const tabsFor = (kind: DocKind): Array<{ id: Tab; label: string }> => (kind === 'tex' ? TEX_TABS : DOC_TABS);

/** 오른쪽 탭 창. 휴대폰에서는 아래에서 올라오는 창이 된다. */
export default function SidePanel({ kind }: { kind: DocKind }) {
  const tab = useEditor((s) => s.tab);
  const setTab = useEditor((s) => s.setTab);
  const open = useEditor((s) => s.sheetOpen);
  const closeSheet = useEditor((s) => s.closeSheet);
  const pending = useEditor(selectPendingCount);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const TABS = tabsFor(kind);

  // 문서 종류에 없는 탭이 골라져 있으면 첫 탭으로 바꾼다.
  useEffect(() => {
    const first = TABS[0];
    if (first && !TABS.some((t) => t.id === tab)) setTab(first.id);
  }, [TABS, tab, setTab]);

  const onKey = (e: KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    const target = TABS[next];
    if (!target) return;
    setTab(target.id);
    refs.current[next]?.focus();
  };

  return (
    <aside className={`side${open ? ' open' : ''}`} aria-label="AI 도우미" data-testid="side-panel">
      <div className="sheet-h">
        <span>AI 도우미</span>
        <button type="button" className="btn ghost sm" onClick={closeSheet}>
          닫기
        </button>
      </div>
      <div className="tabs" role="tablist" aria-label="AI 도우미 탭">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            className="tab"
            aria-selected={tab === t.id}
            aria-controls={`pane-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {t.label}
            {t.id === 'changes' && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </div>
      {tab === 'chat' && <ChatPane kind={kind} />}
      {tab === 'format' && kind !== 'tex' && <FormatPane kind={kind} />}
      {tab === 'compile' && kind === 'tex' && <CompilePane />}
      {tab === 'changes' && <ChangesPane />}
    </aside>
  );
}
