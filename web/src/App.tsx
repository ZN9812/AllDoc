import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import ConsentDialog from './components/ConsentDialog';
import Toaster from './components/Toaster';
import { applyTheme } from './lib/theme';
import { useTitle } from './lib/useTitle';
import EditorPage from './pages/EditorPage';
import HomePage from './pages/HomePage';
import MyDocsPage from './pages/MyDocsPage';
import SettingsPage from './pages/SettingsPage';
import { useAuth } from './state/auth';
import { useSettings } from './state/settings';
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

/** 로그인에 실패해 돌아왔을 때(/?login=failed) 한 번 알리고 주소를 깨끗하게 만든다. */
function LoginNotice() {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('login') !== 'failed') return;
    toast('로그인하지 못했어요. 다시 시도해 주세요.', 'error');
    const rest = new URLSearchParams(params);
    rest.delete('login');
    setParams(rest, { replace: true });
  }, [params, setParams]);
  return null;
}

export default function App() {
  const theme = useSettings((s) => s.theme);
  const refreshAuth = useAuth((s) => s.refresh);

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
  }, [refreshAuth]);

  return (
    <BrowserRouter>
      <LoginNotice />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/docs" element={<MyDocsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/edit/:id" element={<EditorRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
      <ConsentDialog />
    </BrowserRouter>
  );
}
