import { useEffect, useRef, useState } from 'react';
import { loginUrl } from '../ai/client';
import { useInviteLogin, useSite } from '../state/site';

/** 주소에 ?invite=코드 가 있으면 그 값을 넣어 둔다(초대 메일의 링크). */
const inviteFromUrl = (): string => (typeof location === 'undefined' ? '' : (new URLSearchParams(location.search).get('invite') ?? ''));

/** 비공개 베타 로그인: 초대 코드를 적고 로그인한다. 이메일로 초대받은 사람은 비워 두고 로그인하면 된다. */
export default function InviteLoginDialog() {
  const site = useSite((s) => s.site);
  const next = useInviteLogin((s) => s.next);
  const close = useInviteLogin((s) => s.close);
  const [code, setCode] = useState(inviteFromUrl);
  const ref = useRef<HTMLDialogElement>(null);
  const visible = next !== null && (site?.beta ?? false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (visible && !d.open) d.showModal();
    if (!visible && d.open) d.close();
  }, [visible]);

  const contact = site?.contact;
  return (
    <dialog ref={ref} className="modal" aria-labelledby="invite-title" onCancel={() => close()}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (next !== null) window.location.assign(loginUrl(next, code));
        }}
      >
        <h2 id="invite-title">비공개 베타 로그인</h2>
        <p>지금은 초대받은 분만 로그인할 수 있어요. 초대 코드를 받았다면 적어 주세요. 이메일로 초대받았다면 비워 두고 그 이메일의 계정으로 로그인하면 돼요.</p>
        <label className="form-row">
          <span>초대 코드</span>
          <input type="text" name="invite" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="예: ABCDE-23456" />
        </label>
        {contact && (
          <p>
            초대를 받고 싶다면{' '}
            {contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : contact.url ? <a href={contact.url} target="_blank" rel="noreferrer">문의 페이지</a> : null}
            로 문의해 주세요.
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => close()}>
            취소
          </button>
          <button type="submit" className="btn primary">
            로그인
          </button>
        </div>
      </form>
    </dialog>
  );
}
