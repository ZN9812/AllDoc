import { useEffect, useState } from 'react';
import { effectiveTheme } from '../lib/theme';
import { useSettings } from '../state/settings';

/** 위쪽 바의 빠른 전환 버튼. "기기 설정 따르기"는 설정 화면에서 고른다. */
export default function ThemeToggle() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const [prefersDark, setPrefersDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const dark = effectiveTheme(theme, prefersDark) === 'dark';
  return (
    <button type="button" className="btn ghost theme-toggle" aria-label="야간 모드" aria-pressed={dark} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
      <span className="label">{dark ? '밝은 화면' : '야간 모드'}</span>
    </button>
  );
}
