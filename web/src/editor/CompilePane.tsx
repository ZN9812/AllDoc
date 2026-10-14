import { countBySeverity, type TexDiagnostic } from '@alldoc/shared';
import { loginUrl } from '../ai/client';
import { compileAvailability, useAuth } from '../state/auth';
import { useTerms } from '../state/terms';
import { texCompileNote } from './coverage';
import { useEditor } from './store';
import { isBusy, useTex } from './tex/store';

const SEVERITY_LABEL: Record<TexDiagnostic['severity'], string> = { error: '오류', warning: '경고', info: '알림' };

/** LaTeX 컴파일 탭: 컴파일 단추, 오류·경고 목록(누르면 그 파일·줄로), 원본 로그 */
export default function CompilePane() {
  const me = useAuth((s) => s.me);
  const { phase, result, error, compile, jumpTo } = useTex();
  const closeSheet = useEditor((s) => s.closeSheet);
  const avail = compileAvailability(me);
  const busy = isBusy(phase);
  const ds = result?.diagnostics ?? [];
  const c = countBySeverity(ds);

  return (
    <div className="pane" id="pane-compile" role="tabpanel" aria-labelledby="tab-compile">
      {!avail.ok ? (
        <div className="gate">
          <p>
            <b>{avail.message}</b>
          </p>
          {avail.reason === 'login' && (
            <a className="btn primary" href={loginUrl(window.location.pathname)}>
              {me?.authMode === 'dev' ? '로그인(개발용)' : '구글로 로그인'}
            </a>
          )}
          {avail.reason === 'agreement' && (
            <button type="button" className="btn primary" onClick={() => useTerms.getState().show()}>
              약관 보고 동의하기
            </button>
          )}
        </div>
      ) : (
        <>
          {me?.compile?.demo && <p className="demo-note">데모 컴파일러가 연결되어 있어요. 실제 TeX가 아니라 정해 둔 예시 PDF와 로그만 돌려줍니다.</p>}
          <div className="compile-run">
            <button type="button" className="btn primary" disabled={busy || !compile} onClick={() => compile?.()}>
              {busy ? '컴파일 중…' : '컴파일'}
            </button>
            <span className="mut">Ctrl+S · Ctrl+Enter</span>
          </div>
          {phase === 'failed' && error && (
            <p className="compile-err" role="alert">
              {error}
            </p>
          )}
          {result && (
            <>
              <p className="compile-sum" data-testid="compile-summary">
                {result.status === 'ok' && (result.cached ? '바뀐 파일이 없어 이전 PDF를 보여 줘요.' : `PDF를 만들었어요(${(result.ms / 1000).toFixed(1)}초).`)}
                {result.status === 'error' && 'TeX 오류로 PDF를 만들지 못했어요.'}
                {result.status === 'timeout' && `시간 제한(${me?.compile?.timeoutSec ?? '?'}초)을 넘어 멈췄어요.`}
                {result.status === 'too_large' && '만든 PDF나 로그가 너무 커서 받지 못했어요.'}
                {result.status === 'failed' && '컴파일 서버에 문제가 생겼어요.'} 오류 {c.error} · 경고 {c.warning}
              </p>
              {ds.length > 0 && (
                <ul className="diag" aria-label="오류와 경고">
                  {ds.map((d, i) => {
                    const where = d.file ? `${d.file}${d.line !== null ? `:${d.line}` : ''}` : null;
                    const canJump = d.file !== null && d.line !== null;
                    return (
                      <li key={i} className={d.severity}>
                        <button
                          type="button"
                          disabled={!canJump}
                          onClick={() => {
                            if (!canJump) return;
                            jumpTo(d.file as string, d.line as number);
                            closeSheet();
                          }}
                        >
                          <span className="sev">{SEVERITY_LABEL[d.severity]}</span>
                          {where && <span className="where">{where}</span>}
                          <span className="msg">{d.message}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <details className="rawlog">
                <summary>원본 로그 보기</summary>
                <pre>{result.logTail}</pre>
              </details>
            </>
          )}
          {!result && phase === 'idle' && <p className="mut">컴파일하면 오류와 경고가 여기에 나와요. 누르면 그 파일·줄로 이동해요.</p>}
          {me?.compile && (
            <p className="quota" data-testid="coverage-note">
              {texCompileNote(me.compile)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
