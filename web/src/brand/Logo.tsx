import { Link } from 'react-router-dom';
import { BRAND_NAME } from './brand';

/** 겹친 문서 기호: 여러 형식을 한 곳에서 */
export function LogoSymbol({ className = 'sym' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="3.5" width="17" height="21" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" opacity=".35" />
      <rect x="8" y="7" width="17" height="21" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" opacity=".65" />
      <rect x="12" y="10.5" width="17" height="19" rx="2.5" fill="currentColor" />
      <path className="cut" d="M16.2 16.5h8.6M16.2 21.2h5.6" fill="none" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function Logo() {
  return (
    <Link to="/" className="logo" aria-label={`${BRAND_NAME} 홈`}>
      <LogoSymbol />
      <span className="word">{BRAND_NAME}</span>
    </Link>
  );
}
