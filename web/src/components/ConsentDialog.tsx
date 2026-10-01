import { useEffect, useRef } from 'react';
import { providerName } from '../ai/providerName';
import { useAuth } from '../state/auth';
import { useConsent } from '../state/consent';

/** AI 를 처음 쓸 때 한 번 받는 동의. 문서 내용이 AI 서비스로 전송된다는 점을 먼저 알린다. */
export default function ConsentDialog() {
  const pending = useConsent((s) => s.resolver !== null);
  const answer = useConsent((s) => s.answer);
  const provider = useAuth((s) => s.me?.ai.provider);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (pending && !d.open) d.showModal();
    if (!pending && d.open) d.close();
  }, [pending]);

  const name = providerName(provider);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="consent-title" onCancel={() => answer(false)}>
      <h2 id="consent-title">AI를 쓰면 문서 내용이 AI 서비스로 전송돼요</h2>
      <p>
        AI에게 요청할 때마다 지금 열린 문서의 글과 서식 정보가 이 서비스의 서버를 거쳐 <b>{name}</b>(으)로 전송됩니다.
      </p>
      <p>주민등록번호 같은 개인정보가 있거나 기관 밖으로 내보내면 안 되는 문서에는 AI를 쓰지 마세요. 설정에서 언제든 AI 기능을 끌 수 있어요.</p>
      <p>AI 없이도 편집과 서식 점검은 그대로 쓸 수 있어요.</p>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={() => answer(false)}>
          취소
        </button>
        <button type="button" className="btn primary" onClick={() => answer(true)}>
          동의하고 계속
        </button>
      </div>
    </dialog>
  );
}
