import type { ReactNode } from 'react';
import { loginUrl } from '../ai/client';
import { useInviteLogin, useSite } from '../state/site';

/** 로그인 버튼. 비공개 베타 서버에서는 바로 가지 않고 초대 코드를 묻는 창을 연다. */
export default function LoginLink({ next, className, children }: { next: string; className: string; children: ReactNode }) {
  const beta = useSite((s) => s.site?.beta ?? false);
  const open = useInviteLogin((s) => s.open);
  if (!beta) {
    return (
      <a className={className} href={loginUrl(next)}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" className={className} onClick={() => open(next)}>
      {children}
    </button>
  );
}
