import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes, useParams } from 'react-router-dom';
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
