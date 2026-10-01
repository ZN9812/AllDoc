import { CATEGORY_LABEL } from '@alldoc/shared';
import { selectPendingCount, useEditor, type ProposalItem } from './store';

export default function ChangesPane() {
  const items = useEditor((s) => s.items);
  const pending = useEditor(selectPendingCount);
  const applyAll = useEditor((s) => s.applyAll);

  if (items.length === 0) {
    return (
      <div className="pane" id="pane-changes" role="tabpanel">
        <p className="empty">아직 제안이 없어요. 서식 점검에서 변경을 올리거나, AI 대화에서 문서를 어떻게 고칠지 시켜 보세요. 적용하기 전에는 문서가 바뀌지 않아요.</p>
      </div>
    );
  }

  return (
    <div className="pane" id="pane-changes" role="tabpanel">
      <div className="ch-head">
        <h3>제안 {items.length}건</h3>
        <button type="button" className="btn primary sm" disabled={pending === 0} onClick={() => void applyAll()}>
          전체 적용
        </button>
      </div>
      <ul className="cards">
        {items.map((it) => (
          <Card key={it.proposal.id} item={it} />
        ))}
      </ul>
    </div>
  );
}

function Card({ item }: { item: ProposalItem }) {
  const { proposal: p, status, message } = item;
  const applyItem = useEditor((s) => s.applyItem);
  const dismissItem = useEditor((s) => s.dismissItem);
  const revertItem = useEditor((s) => s.revertItem);
  const restoreItem = useEditor((s) => s.restoreItem);
  const setFocus = useEditor((s) => s.setFocus);
  const revealItem = useEditor((s) => s.revealItem);
  const canReveal = useEditor((s) => Boolean(s.engine?.reveal));
  const locate = canReveal && status !== 'dismissed' && status !== 'applied' && (
    <button type="button" className="link" onClick={() => revealItem(p.id)}>
      문서에서 보기
    </button>
  );

  return (
    <li
      className="card"
      data-state={status}
      data-testid="proposal-card"
      onMouseEnter={() => setFocus(p.id)}
      onMouseLeave={() => setFocus(null)}
      onFocus={() => setFocus(p.id)}
      onBlur={() => setFocus(null)}
    >
      <div className="card-t">
        <b>{p.title}</b>
        <span className="chip">{CATEGORY_LABEL[p.category]}</span>
      </div>
      {p.place && (
        <div className="where">
          <span className="chip" data-testid="proposal-place">
            {p.place}
          </span>
        </div>
      )}
      <p>{p.description}</p>
      <div className="diff">
        <span className="from">{p.before}</span>
        <span aria-hidden="true">→</span>
        <span className="to">{p.after}</span>
      </div>
      <div className="card-a">
        {status === 'pending' && (
          <>
            <button type="button" className="btn ghost sm" onClick={() => void applyItem(p.id)}>
              적용
            </button>
            <button type="button" className="link" onClick={() => dismissItem(p.id)}>
              취소
            </button>
            {locate}
          </>
        )}
        {status === 'applied' && (
          <>
            <span className="st">적용됨</span>
            <button type="button" className="link" onClick={() => void revertItem(p.id)}>
              되돌리기
            </button>
          </>
        )}
        {status === 'dismissed' && (
          <>
            <span className="st">취소함</span>
            <button type="button" className="link" onClick={() => restoreItem(p.id)}>
              다시 보기
            </button>
          </>
        )}
        {(status === 'stale' || status === 'failed') && (
          <>
            <span className="st bad">{message ?? '적용하지 못했어요.'}</span>
            <button type="button" className="link" onClick={() => restoreItem(p.id)}>
              다시 시도
            </button>
            {locate}
          </>
        )}
        {status === 'applied' && message && <span className="st bad">{message}</span>}
      </div>
    </li>
  );
}
