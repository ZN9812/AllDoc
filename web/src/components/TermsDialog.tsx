import { useEffect, useRef, useState } from 'react';
import { ApiError, postAgree } from '../ai/client';
import { useAuth } from '../state/auth';
import { useTerms } from '../state/terms';
import { toast } from '../state/toast';

/** 이용약관·개인정보처리방침 동의와 만 14세 이상 확인. 서버에 약관 판(TERMS_VERSION)이 있을 때만 나온다. */
export default function TermsDialog() {
  const me = useAuth((s) => s.me);
  const refresh = useAuth((s) => s.refresh);
  const open = useTerms((s) => s.open);
  const show = useTerms((s) => s.show);
  const hide = useTerms((s) => s.hide);
  const [age14, setAge14] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const agreement = me?.authenticated ? me.agreement : null;
  const required = agreement?.required ?? false;

  useEffect(() => {
    if (required && !useTerms.getState().dismissed) show();
  }, [required, show]);

  const visible = open && required;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (visible && !d.open) d.showModal();
    if (!visible && d.open) d.close();
  }, [visible]);

  async function submit() {
    if (!agreement || busy) return;
    setBusy(true);
    try {
      await postAgree(agreement.version);
      await refresh();
      hide();
      toast('약관에 동의했어요.');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : '동의를 저장하지 못했어요. 다시 시도해 주세요.', 'error');
      if (e instanceof ApiError && e.status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="modal" aria-labelledby="terms-title" onCancel={() => hide(true)}>
      <h2 id="terms-title">이용약관 동의</h2>
      <p>AI 기능을 쓰려면 이용약관과 개인정보처리방침에 동의해야 해요. 문서 편집과 서식 점검은 동의 없이도 쓸 수 있어요.</p>
      <p>
        {agreement?.termsUrl && (
          <a href={agreement.termsUrl} target="_blank" rel="noreferrer">
            이용약관 보기
          </a>
        )}
        {agreement?.termsUrl && agreement.privacyUrl && ' · '}
        {agreement?.privacyUrl && (
          <a href={agreement.privacyUrl} target="_blank" rel="noreferrer">
            개인정보처리방침 보기
          </a>
        )}
      </p>
      <label className="radio-line">
        <input type="checkbox" checked={age14} onChange={(e) => setAge14(e.target.checked)} />만 14세 이상이에요
      </label>
      <label className="radio-line">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        이용약관과 개인정보처리방침에 동의해요
      </label>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={() => hide(true)}>
          나중에
        </button>
        <button type="button" className="btn primary" disabled={!age14 || !agreed || busy} onClick={() => void submit()}>
          동의
        </button>
      </div>
    </dialog>
  );
}
