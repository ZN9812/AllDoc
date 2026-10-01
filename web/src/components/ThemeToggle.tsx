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
    <button type="button" className="btn ghost" aria-pressed={dark} onClick={() => setTheme(dark ? 'light' : 'dark')}>
      {dark ? '밝은 화면' : '야간 모드'}
    </button>
  );
}
