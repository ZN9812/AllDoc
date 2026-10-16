import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import ConsentDialog from './components/ConsentDialog';
import InviteLoginDialog from './components/InviteLoginDialog';
import TermsDialog from './components/TermsDialog';
import Toaster from './components/Toaster';
import { applyTheme } from './lib/theme';
import { useTitle } from './lib/useTitle';
import EditorPage from './pages/EditorPage';
import HomePage from './pages/HomePage';
import MyDocsPage from './pages/MyDocsPage';
import PolicyPage from './pages/PolicyPage';
import SettingsPage from './pages/SettingsPage';
import { useAuth } from './state/auth';
import { useSettings } from './state/settings';
import { useInviteLogin, useSite } from './state/site';
import { toast } from './state/toast';

function EditorRoute() {
  const { id } = useParams();
  // 문서가 바뀌면 편집 화면을 통째로 새로 만든다(저장·편집기 상태가 섞이지 않도록).
  return id ? <EditorPage key={id} id={id} /> : <NotFound />;
}

function NotFound() {
  useTitle('찾을 수 없는 페이지');
  return (
    <div className="engine-error" role="alert">
      <p>찾을 수 없는 페이지예요.</p>
      <Link className="btn primary" to="/">
        홈으로
      </Link>
    </div>
  );
}

const LOGIN_NOTICES: Record<string, string> = {
  failed: '로그인하지 못했어요. 다시 시도해 주세요.',
  blocked: '이 계정은 이용이 제한되어 있어요. 운영자에게 문의해 주세요.',
  invite: '비공개 베타 기간이라 초대받은 분만 로그인할 수 있어요. 초대 코드나 초대받은 이메일을 확인해 주세요.',
};

/**
 * 로그인에 실패해 돌아왔을 때(/?login=failed, 차단된 계정은 blocked, 베타 초대가 없으면 invite) 한 번 알리고 주소를 깨끗하게 만든다.
 * 초대 메일의 링크(/?invite=코드)로 들어오면 비공개 베타 로그인 창을 연다.
 */
function LoginNotice() {
  const [params, setParams] = useSearchParams();
  const beta = useSite((s) => s.site?.beta ?? false);
  const authenticated = useAuth((s) => s.me?.authenticated ?? false);
  useEffect(() => {
    if (beta && !authenticated && params.get('invite')) useInviteLogin.getState().open('/');
  }, [beta, authenticated, params]);
  useEffect(() => {
    const login = params.get('login');
    const message = login ? LOGIN_NOTICES[login] : undefined;
    if (!message) return;
    toast(message, 'error');
    const rest = new URLSearchParams(params);
    rest.delete('login');
    setParams(rest, { replace: true });
  }, [params, setParams]);
  return null;
}

export default function App() {
  const theme = useSettings((s) => s.theme);
  const refreshAuth = useAuth((s) => s.refresh);
  const loadSite = useSite((s) => s.load);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  useEffect(() => {
    void refreshAuth();
    void loadSite();
  }, [refreshAuth, loadSite]);

  return (
    <BrowserRouter>
      <LoginNotice />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<MyDocsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/edit/:id" element={<EditorRoute />} />
        <Route path="/terms" element={<PolicyPage name="terms" />} />
        <Route path="/privacy" element={<PolicyPage name="privacy" />} />
        <Route path="/refund" element={<PolicyPage name="refund" />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
      <ConsentDialog />
      <TermsDialog />
      <InviteLoginDialog />
    </BrowserRouter>
  );
}
