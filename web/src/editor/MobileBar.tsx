import { selectPendingCount, useEditor } from './store';

/** 휴대폰 아래 막대: 탭 창을 아래에서 올리는 버튼들 */
export default function MobileBar() {
  const pages = useEditor((s) => s.pages);
  const pending = useEditor(selectPendingCount);
  const openSheet = useEditor((s) => s.openSheet);
  return (
    <div className="mbar">
      {pages && pages.count > 0 && (
        <span className="pgno">
          {pages.current + 1} / {pages.count}쪽
        </span>
      )}
      <span className="sp" />
      <button type="button" className="btn ghost sm" onClick={() => openSheet('chat')}>
        AI 대화
      </button>
      <button type="button" className="btn ghost sm" onClick={() => openSheet('format')}>
        서식 점검
      </button>
      <button type="button" className="btn ghost sm" onClick={() => openSheet('changes')}>
        변경 내역 {pending > 0 && <span className="badge">{pending}</span>}
      </button>
    </div>
  );
}
