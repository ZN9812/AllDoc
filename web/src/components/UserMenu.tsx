import { useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { loginUrl } from '../ai/client';
import { useClickOutside } from '../lib/useClickOutside';
import { useAuth } from '../state/auth';

/** 로그인 버튼 또는 계정 메뉴. 로그인은 AI 사용 횟수를 관리하는 데만 쓰인다. */
export default function UserMenu() {
  const me = useAuth((s) => s.me);
  const logout = useAuth((s) => s.logout);
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  // 서버에 연결할 수 없거나 로그인이 필요 없는 설정이면 아무것도 보이지 않는다.
  if (!me || me.authMode === 'none') return null;

  if (!me.authenticated) {
    return (
      <a className="btn ghost" href={loginUrl(loc.pathname + loc.search)}>
        로그인
      </a>
    );
  }

  const name = me.user?.name ?? me.user?.email ?? '나';
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label="내 계정" onClick={() => setOpen((v) => !v)}>
        {name.slice(0, 1)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="who">
            <b>{name}</b>
            {me.user?.email}
          </div>
          {me.quota && (
            <div className="hint">
              오늘 남은 AI 사용 횟수 {me.quota.remaining}/{me.quota.limit}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
