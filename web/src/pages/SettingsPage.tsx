import { useState } from 'react';
import { ACCOUNT_DELETE_CONFIRM } from '@alldoc/shared';
import { ApiError, postDeleteAccount, postLogoutAll } from '../ai/client';
import { providerName } from '../ai/providerName';
import { SOURCE_URL } from '../brand/brand';
import Nav from '../components/Nav';
import SiteFooter from '../components/SiteFooter';
import TopBar from '../components/TopBar';
import { removeDoc } from '../lib/docs';
import { DOCX_ENABLED } from '../lib/features';
import { useTitle } from '../lib/useTitle';
import { useAuth } from '../state/auth';
import { useSettings, type ThemePref } from '../state/settings';
import { useTerms } from '../state/terms';
import { toast } from '../state/toast';
import { useDocs } from '../state/useDocs';

const THEMES: Array<{ id: ThemePref; label: string }> = [
  { id: 'light', label: '밝게' },
  { id: 'dark', label: '어둡게' },
  { id: 'system', label: '기기 설정 따르기' },
];

export default function SettingsPage() {
  useTitle('설정');
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const aiEnabled = useSettings((s) => s.aiEnabled);
  const setAiEnabled = useSettings((s) => s.setAiEnabled);
  const aiConsentAt = useSettings((s) => s.aiConsentAt);
  const revokeConsent = useSettings((s) => s.revokeConsent);
  const me = useAuth((s) => s.me);
  const refreshAuth = useAuth((s) => s.refresh);
  const { docs, refresh } = useDocs();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deleteDocsToo, setDeleteDocsToo] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logoutAll() {
    setBusy(true);
    try {
      await postLogoutAll();
      toast('모든 기기에서 로그아웃했어요.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '로그아웃하지 못했어요.', 'error');
    } finally {
      setBusy(false);
      await refreshAuth();
    }
  }

  async function deleteAccount() {
    setBusy(true);
    try {
      await postDeleteAccount();
      if (deleteDocsToo && docs.length > 0) await Promise.all(docs.map((d) => removeDoc(d.id)));
      toast(deleteDocsToo ? '계정과 이 브라우저의 문서를 지웠어요.' : '계정을 지웠어요. 이 브라우저의 문서는 그대로 남아 있어요.');
      setDeleting(false);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '계정을 지우지 못했어요.', 'error');
    } finally {
      setBusy(false);
      await refreshAuth();
      await refresh();
    }
  }

  async function clearAll() {
    try {
      await Promise.all(docs.map((d) => removeDoc(d.id)));
      toast('이 브라우저에 저장된 문서를 모두 지웠어요.');
    } catch {
      toast('문서를 지우지 못했어요.', 'error');
    } finally {
      setConfirming(false);
      await refresh();
    }
  }

  return (
    <div className="shell">
      <TopBar mode="home" showSearch={false} />
      <div className="home">
        <Nav />
        <main className="main">
          <h1 className="page-title">설정</h1>

          <section className="form-row" aria-labelledby="set-theme">
            <h3 id="set-theme">화면 색</h3>
            <div role="radiogroup" aria-labelledby="set-theme" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {THEMES.map((t) => (
                <label key={t.id} className="radio-line">
                  <input type="radio" name="theme" value={t.id} checked={theme === t.id} onChange={() => setTheme(t.id)} />
                  {t.label}
                </label>
              ))}
            </div>
          </section>

          {me?.authenticated && me.plan && me.usage && (
            <section className="form-row" aria-labelledby="set-account">
              <h3 id="set-account">계정</h3>
              <p>{[me.user?.name, me.user?.email].filter(Boolean).join(' · ') || '로그인한 계정'}</p>
              <p data-testid="plan-line">
                요금제: {me.plan.name}
                {me.plan.source === 'override' && me.plan.validUntil ? ` (${new Date(me.plan.validUntil).toLocaleDateString('ko-KR')}까지)` : ''}
                {' · '}오늘 AI {me.usage.aiToday}회{me.plan.aiRequestsPerDay !== null ? ` / ${me.plan.aiRequestsPerDay}회` : ''}
                {' · '}이번 달 {me.usage.aiThisMonth}회{me.plan.aiRequestsPerMonth !== null ? ` / ${me.plan.aiRequestsPerMonth}회` : ''}
              </p>
              {me.agreement && (
                <p>
                  {me.agreement.required ? (
                    <>
                      새 약관({me.agreement.version})에 아직 동의하지 않았어요.{' '}
                      <button type="button" className="link" onClick={() => useTerms.getState().show()}>
                        약관 보고 동의하기
                      </button>
                    </>
                  ) : (
                    `약관(${me.agreement.version})에 동의했어요.`
                  )}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void logoutAll()}>
                  모든 기기에서 로그아웃
                </button>
                {!deleting && (
                  <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setDeleting(true)}>
                    계정 삭제
                  </button>
                )}
              </div>
              {deleting && (
                <div className="danger-box" role="group" aria-labelledby="delete-title">
                  <p id="delete-title">
                    <b>계정을 지우면 되돌릴 수 없어요.</b> 이메일·이름을 지우고 모든 기기에서 로그아웃합니다. AI 사용 기록은 누구인지 알 수 없게 바꿔 통계로만 남기고,
                    하루·월 사용 횟수는 62일 동안 남아요(다시 가입해 한도를 되돌리지 못하게 하려는 것).
                  </p>
                  {docs.length > 0 && (
                    <label className="radio-line">
                      <input type="checkbox" checked={deleteDocsToo} onChange={(e) => setDeleteDocsToo(e.target.checked)} />이 브라우저에 저장된 문서 {docs.length}개도 지우기
                    </label>
                  )}
                  <label>
                    <span>
                      확인을 위해 <b>{ACCOUNT_DELETE_CONFIRM}</b>를 적어 주세요
                    </span>
                    <input type="text" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} aria-label="확인 문구" />
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" className="btn ghost sm" disabled={busy || deleteText.trim() !== ACCOUNT_DELETE_CONFIRM} onClick={() => void deleteAccount()}>
                      계정 지우기
                    </button>
                    <button type="button" className="link" onClick={() => setDeleting(false)}>
                      취소
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="form-row" aria-labelledby="set-ai">
            <h3 id="set-ai">AI 기능</h3>
            <label className="radio-line">
              <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
              AI 기능 사용
            </label>
            <p>끄면 AI 대화와 "내 규칙" 점검이 막히고, 문서 내용이 AI 서비스로 전송되지 않아요. 편집과 문서 안 일관성·기준 문서 점검은 그대로 쓸 수 있어요.</p>
            <p>
              {me
                ? me.ai.available
                  ? `연결된 AI: ${providerName(me.ai.provider)}`
                  : '이 서버에는 AI가 연결되어 있지 않아요.'
                : '서버에 연결할 수 없어 AI 상태를 확인하지 못했어요.'}
              {me?.quota ? ` · 오늘 남은 사용 횟수 ${me.quota.remaining}/${me.quota.limit}` : ''}
            </p>
            <p>
              {aiConsentAt ? `문서 전송 안내에 동의했어요(${new Date(aiConsentAt).toLocaleDateString('ko-KR')}).` : '아직 문서 전송 안내에 동의하지 않았어요. AI를 처음 쓸 때 한 번 물어봐요.'}
            </p>
            {aiConsentAt !== null && (
              <div>
                <button type="button" className="btn ghost sm" onClick={revokeConsent}>
                  동의 철회
                </button>
              </div>
            )}
          </section>

          <section className="form-row" aria-labelledby="set-docs">
            <h3 id="set-docs">저장된 문서</h3>
            <p>이 브라우저에 문서 {docs.length}개가 저장되어 있어요. 서버에는 저장되지 않아요.</p>
            {confirming ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span>정말 모두 지울까요? 되돌릴 수 없어요.</span>
                <button type="button" className="btn ghost sm" onClick={() => void clearAll()}>
                  모두 지우기
                </button>
                <button type="button" className="link" onClick={() => setConfirming(false)}>
                  취소
                </button>
              </div>
            ) : (
              <div>
                <button type="button" className="btn ghost sm" disabled={docs.length === 0} onClick={() => setConfirming(true)}>
                  저장된 문서 모두 지우기
                </button>
              </div>
            )}
          </section>

          <section className="form-row" aria-labelledby="set-about">
            <h3 id="set-about">정보</h3>
            <p>
              이 서비스는 AGPL-3.0 라이선스의 오픈소스예요. 소스 코드는{' '}
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                {SOURCE_URL.replace(/^https?:\/\//, '')}
              </a>
              에서 받을 수 있어요.
            </p>
            <p>
              {DOCX_ENABLED
                ? '한글 문서는 rhwp(MIT), Word 문서는 SuperDoc(AGPL-3.0, DOCX 엔진은 별도 독점 라이선스), PDF는 pdf.js(Apache-2.0)로 열어요.'
                : '한글 문서는 rhwp(MIT), PDF는 pdf.js(Apache-2.0)로 열어요.'}{' '}
              자세한 목록은 소스 저장소의 THIRD_PARTY_NOTICES.md에 있어요.
            </p>
          </section>
          <SiteFooter />
        </main>
      </div>
    </div>
  );
}
