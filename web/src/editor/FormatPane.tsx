import { useEffect, useRef } from 'react';
import { CRITERIA, type Criteria, type DocKind } from '@alldoc/shared';
import { loadReference, postConsistencyProposals, runConsistency, runReference, runRulesWithAi } from '../ai/actions';
import { summarizeFindings } from '../ai/consistency';
import { supportsFormat } from '../engines/registry';
import { aiAvailability, useAuth } from '../state/auth';
import { useRules } from '../state/rules';
import { useSettings } from '../state/settings';
import { useEditor } from './store';

const CRITERIA_TEXT: Record<Criteria, { name: string; hint: string }> = {
  consistency: { name: '문서 안 일관성', hint: '같은 역할의 글꼴·크기를 문서 안에서 맞춥니다. 기준을 고르지 않으면 이 방식으로 점검합니다.' },
  reference: { name: '기준 문서', hint: '학교·기관 양식 파일을 올려 그 서식을 기준으로 삼습니다.' },
  rules: { name: '내 규칙', hint: '말로 적은 규칙을 저장해 두고 다시 씁니다.' },
};

export default function FormatPane({ kind }: { kind: DocKind }) {
  const engine = useEditor((s) => s.engine);
  const items = useEditor((s) => s.items);
  const criteria = useEditor((s) => s.criteria);
  const setCriteria = useEditor((s) => s.setCriteria);
  const consistency = useEditor((s) => s.consistency);
  const reference = useEditor((s) => s.reference);
  const setReference = useEditor((s) => s.setReference);
  const rulesText = useEditor((s) => s.rulesText);
  const setRulesText = useEditor((s) => s.setRulesText);
  const flash = useEditor((s) => s.flash);
  const busy = useEditor((s) => s.busy);
  const me = useAuth((s) => s.me);
  const aiEnabled = useSettings((s) => s.aiEnabled);
  const saved = useRules((s) => s.rules);
  const saveRule = useRules((s) => s.save);
  const removeRule = useRules((s) => s.remove);
  const fileInput = useRef<HTMLInputElement>(null);

  const canFormat = supportsFormat(kind);
  const statusSig = items.map((i) => i.status).join(',');

  // 열 때와, 제안을 적용·되돌린 뒤에 다시 점검한다.
  useEffect(() => {
    if (canFormat && engine) void runConsistency();
  }, [canFormat, engine, statusSig]);

  if (!canFormat) {
    return (
      <div className="pane" id="pane-format" role="tabpanel">
        <p className="empty">TXT·MD·PDF는 서식(글꼴·크기 등)을 점검할 수 없어요. 글 문서는 AI 대화에서 문장과 맞춤법을 고칠 수 있어요.</p>
      </div>
    );
  }

  const rows = consistency ? summarizeFindings(consistency) : [];
  const findingCount = consistency?.findings.length ?? 0;
  const avail = aiAvailability(me, aiEnabled);

  return (
    <div className="pane" id="pane-format" role="tabpanel">
      <h3>점검 기준</h3>
      <div className="crit" role="radiogroup" aria-label="점검 기준">
        {CRITERIA.map((c) => (
          <label key={c}>
            <input type="radio" name="criteria" value={c} checked={criteria === c} onChange={() => setCriteria(c)} />
            <b>{CRITERIA_TEXT[c].name}</b>
            <small>{CRITERIA_TEXT[c].hint}</small>
          </label>
        ))}
      </div>

      {criteria === 'reference' && (
        <div className="extra">
          {reference ? (
            <span>
              기준 문서: <b>{reference.name}</b>
            </span>
          ) : (
            <span>HWP · HWPX · DOCX 양식 파일</span>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn ghost sm" onClick={() => fileInput.current?.click()}>
              {reference ? '다른 양식 선택' : '양식 파일 선택'}
            </button>
            {reference && (
              <button type="button" className="link" onClick={() => setReference(null)}>
                지우기
              </button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".hwp,.hwpx,.docx,.txt,.md"
            data-testid="reference-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadReference(f);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {criteria === 'rules' && (
        <div className="extra">
          <textarea
            aria-label="내 규칙"
            value={rulesText}
            placeholder="예: 본문은 맑은 고딕 11pt, 줄 간격 160%, 제목은 가운데 정렬"
            onChange={(e) => setRulesText(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn ghost sm" disabled={rulesText.trim().length === 0} onClick={() => saveRule(rulesText)}>
              내 규칙으로 저장
            </button>
            {saved.length > 0 && (
              <select
                aria-label="저장한 규칙 불러오기"
                value=""
                onChange={(e) => {
                  const r = saved.find((x) => x.id === e.target.value);
                  if (r) setRulesText(r.text);
                }}
              >
                <option value="">저장한 규칙 불러오기</option>
                {saved.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            {saved.length > 0 && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  const r = saved.find((x) => x.text === rulesText.trim());
                  if (r) removeRule(r.id);
                }}
              >
                이 규칙 지우기
              </button>
            )}
          </div>
        </div>
      )}

      <h3>점검 결과</h3>
      {consistency === null ? (
        <p className="empty">문서를 읽는 중…</p>
      ) : rows.length === 0 ? (
        <p className="empty">같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.</p>
      ) : (
        <ul className="res">
          {rows.map((r) => (
            <li key={r.id} className={r.ok ? 'ok' : undefined}>
              <button type="button" onClick={() => r.paragraphs.length > 0 && flash(r.paragraphs.map((p) => ({ paragraph: p })))}>
                <i />
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {criteria === 'consistency' && (
        <button type="button" className="btn primary" disabled={findingCount === 0} onClick={() => postConsistencyProposals()}>
          변경 내역에 올리기
        </button>
      )}
      {criteria === 'reference' && (
        <button type="button" className="btn primary" disabled={!reference} onClick={() => void runReference()}>
          기준에 맞추기
        </button>
      )}
      {criteria === 'rules' && (
        <>
          <button type="button" className="btn primary" disabled={!avail.ok || busy || rulesText.trim().length === 0} onClick={() => void runRulesWithAi()}>
            AI로 고치기
          </button>
          {!avail.ok && <p className="quota">{avail.message}</p>}
        </>
      )}
      <p className="quota">점검 결과 보기와 "변경 내역에 올리기"는 로그인 없이 쓸 수 있어요. 올린 제안은 적용하기 전에는 문서를 바꾸지 않아요.</p>
    </div>
  );
}
