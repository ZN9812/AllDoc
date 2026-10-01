import { NavLink } from 'react-router-dom';

export default function Nav() {
  return (
    <nav className="nav" aria-label="메뉴">
      <NavLink to="/" end>
        새 문서
      </NavLink>
      <NavLink to="/docs">내 문서</NavLink>
      <NavLink to="/settings">설정</NavLink>
    </nav>
  );
}
