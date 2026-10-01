import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// 임시 진입점: 다음 단계에서 앱 껍데기로 교체한다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <h1>AllDoc</h1>
  </StrictMode>,
);
