import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { DocKind } from '@alldoc/shared';
import type { TexScope } from '../engines/types';
import { askAi } from '../ai/actions';
import LoginLink from '../components/LoginLink';
import { useLocation, Link } from 'react-router-dom';
import { aiAvailability, useAuth } from '../state/auth';
import { useTerms } from '../state/terms';
import { useSettings } from '../state/settings';
import { COVERAGE_NOTE } from './coverage';
import { useEditor } from './store';

/** LaTeX 원고에 미리 정한 지시(모드를 따로 두지 않고 대화로 보낸다, docs/LATEX.md) */
const TEX_PRESETS: Array<{ label: string; instruction: string }> = [
  { label: '학술 문체로 다듬기', instruction: '본문 문장을 한국어 학술 문체(평서형 "-다")로 다듬어 줘.' },
  { label: '영어 문장 다듬기', instruction: '본문의 영어 문장을 자연스러운 학술 영어로 다듬어 줘.' },
  { label: '맞춤법', instruction: '본문의 맞춤법과 띄어쓰기를 고쳐 줘.' },
  { label: '용어 통일', instruction: '같은 개념을 가리키는 용어가 섞여 있으면 하나로 통일해 줘.' },
];

const TEX_SCOPES: Array<{ id: TexScope; label: string }> = [
  { id: 'file', label: '지금 파일' },
  { id: 'selection', label: '선택 영역' },
  { id: 'project', label: '프로젝트 전체' },
];

export default function ChatPane({ kind }: { kind: DocKind }) {
  const me = useAuth((s) => s.me);
  const aiEnabled = useSettings((s) => s.aiEnabled);
  const thread = useEditor((s) => s.thread);
  const busy = useEditor((s) => s.busy);
  const engine = useEditor((s) => s.engine);
  const setTab = useEditor((s) => s.setTab);
  const texScope = useEditor((s) => s.texScope);
  const setTexScope = useEditor((s) => s.setTexScope);
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
              <LoginLink className="btn primary" next={loc.pathname + loc.search}>
                {me?.authMode === 'dev' ? '로그인(개발용)' : '구글로 로그인'}
              </LoginLink>
            </>
          )}
          {avail.reason === 'agreement' && (
            <button type="button" className="btn primary" onClick={() => useTerms.getState().show()}>
              약관 보고 동의하기
            </button>
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
        {thread.length === 0 && (
          <div className="bub">{kind === 'tex' ? '원고를 어떻게 고칠까요? 예: "맞춤법을 확인해 줘", "이 절을 학술 문체로 다듬어 줘"' : '문서를 어떻게 고칠까요? 예: "맞춤법을 확인해 줘", "공문서 말투로 바꿔 줘"'}</div>
        )}
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
      {kind === 'tex' && (
        <div className="tex-ask">
          <div className="scope" role="radiogroup" aria-label="AI에 보낼 범위">
            {TEX_SCOPES.map((s) => (
              <label key={s.id}>
                <input type="radio" name="tex-scope" value={s.id} checked={texScope === s.id} onChange={() => setTexScope(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
          <div className="presets">
            {TEX_PRESETS.map((p) => (
              <button key={p.label} type="button" className="btn ghost sm" disabled={busy || !engine} onClick={() => void askAi(p.instruction)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
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
