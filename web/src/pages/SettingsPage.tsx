import { useState } from 'react';
import { providerName } from '../ai/providerName';
import { BRAND_NAME, SOURCE_URL } from '../brand/brand';
import Nav from '../components/Nav';
import TopBar from '../components/TopBar';
import { removeDoc } from '../lib/docs';
import { useTitle } from '../lib/useTitle';
import { useAuth } from '../state/auth';
import { useSettings, type ThemePref } from '../state/settings';
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
  const { docs, refresh } = useDocs();
  const [confirming, setConfirming] = useState(false);

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
              {BRAND_NAME}은(는) AGPL-3.0 라이선스의 오픈소스예요. 이 서비스의 소스 코드는{' '}
              <a href={SOURCE_URL} target="_blank" rel="noreferrer">
                {SOURCE_URL.replace(/^https?:\/\//, '')}
              </a>
              에서 받을 수 있어요.
            </p>
            <p>
              한글 문서는 rhwp(MIT), Word 문서는 SuperDoc(AGPL-3.0), PDF는 pdf.js(Apache-2.0)로 열어요. 자세한 목록은 소스 저장소의 THIRD_PARTY_NOTICES.md에 있어요.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
