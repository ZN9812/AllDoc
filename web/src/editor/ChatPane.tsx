import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DocKind } from '@alldoc/shared';
import { askAi } from '../ai/actions';
import { loginUrl } from '../ai/client';
import { useLocation, Link } from 'react-router-dom';
import { aiAvailability, useAuth } from '../state/auth';
import { useSettings } from '../state/settings';
import { COVERAGE_NOTE } from './coverage';
import { useEditor } from './store';

export default function ChatPane({ kind }: { kind: DocKind }) {
  const me = useAuth((s) => s.me);
  const aiEnabled = useSettings((s) => s.aiEnabled);
  const thread = useEditor((s) => s.thread);
  const busy = useEditor((s) => s.busy);
  const engine = useEditor((s) => s.engine);
  const setTab = useEditor((s) => s.setTab);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const loc = useLocation();

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [thread.length, busy]);

  if (kind === 'pdf') {
    return (
      <div className="pane" id="pane-chat" role="tabpanel">
        <div className="gate">
          <p>
            <b>PDF는 글을 고칠 수 없어요.</b>
          </p>
          <p className="mut">PDF는 보기만 할 수 있어서 AI 제안을 쓸 수 없어요. HWP, HWPX, DOCX, TXT, MD 문서에서 AI를 써 보세요.</p>
        </div>
      </div>
    );
  }

  const avail = aiAvailability(me, aiEnabled);
  if (!avail.ok) {
    return (
      <div className="pane" id="pane-chat" role="tabpanel">
        <div className="gate">
          <p>
            <b>{avail.message}</b>
          </p>
          {avail.reason === 'login' && (
            <>
              <p className="mut">로그인은 하루 사용 횟수를 관리하는 데만 쓰이고, 문서는 이 브라우저에만 저장됩니다. 문서 편집과 서식 점검은 로그인 없이 쓸 수 있어요.</p>
              <a className="btn primary" href={loginUrl(loc.pathname + loc.search)}>
                {me?.authMode === 'dev' ? '로그인(개발용)' : '구글로 로그인'}
              </a>
            </>
          )}
          {avail.reason === 'off' && (
            <Link className="btn primary" to="/settings">
              설정에서 켜기
            </Link>
          )}
        </div>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    await askAi(value);
  };

  return (
    <div className="pane" id="pane-chat" role="tabpanel" ref={box}>
      {me?.ai.demo && <p className="demo-note">데모 AI가 연결되어 있어요. 실제 AI가 아니라 미리 정해 둔 예시 제안만 돌려줍니다.</p>}
      <div className="thread" aria-live="polite">
        {thread.length === 0 && <div className="bub">문서를 어떻게 고칠까요? 예: "맞춤법을 확인해 줘", "공문서 말투로 바꿔 줘"</div>}
        {thread.map((m) => (
          <div key={m.id} className={`bub${m.role === 'user' ? ' me' : ''}${m.tone === 'error' ? ' err' : ''}${m.tone === 'demo' ? ' demo' : ''}`}>
            {m.content}
            {m.hasProposals && (
              <>
                {' '}
                <button type="button" className="link" onClick={() => setTab('changes')}>
                  변경 내역 보기
                </button>
              </>
            )}
          </div>
        ))}
        {busy && <div className="bub">AI가 문서를 살펴보는 중이에요…</div>}
      </div>
      <form className="ask" onSubmit={onSubmit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={engine ? 'AI에게 시키기' : '문서를 여는 중…'}
          aria-label="AI에게 시키기"
          disabled={busy || !engine}
          autoComplete="off"
        />
        <button type="submit" className="btn primary" disabled={busy || !engine || text.trim().length === 0}>
          보내기
        </button>
      </form>
      {me?.quota && (
        <p className="quota">
          오늘 남은 AI 사용 횟수 {me.quota.remaining}/{me.quota.limit}
        </p>
      )}
      {COVERAGE_NOTE[kind] && (
        <p className="quota" data-testid="coverage-note">
          {COVERAGE_NOTE[kind]}
        </p>
      )}
    </div>
  );
}
