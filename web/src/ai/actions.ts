// 화면의 버튼이 부르는 AI·서식 점검 동작. 모든 결과는 "제안"으로 변경 내역에 올라가고, 사용자가 적용하기 전에는 문서가 바뀌지 않는다.
import { MAX_DOC_CHARS, type AiRequest, type DocSummary } from '@alldoc/shared';
import { useEditor } from '../editor/store';
import { summarizeBlob } from '../engines/headless';
import { checkUpload } from '../lib/files';
import { aiAvailability, useAuth } from '../state/auth';
import { ensureConsent } from '../state/consent';
import { useSettings } from '../state/settings';
import { toast } from '../state/toast';
import { ApiError, postPropose } from './client';
import { analyzeConsistency, buildProfile, compareToProfile } from './consistency';

const totalChars = (s: DocSummary): number => s.paragraphs.reduce((n, p) => n + p.text.length, 0);

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return '알 수 없는 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.';
}

type CallOptions = Pick<AiRequest, 'mode' | 'instruction'> & Partial<Pick<AiRequest, 'criteria' | 'rulesText' | 'reference'>>;

/** 서버에 AI 요청을 보내고 결과를 대화와 변경 내역에 반영한다. 성공하면 true. */
async function callAi(opts: CallOptions, userMessage: string): Promise<boolean> {
  const ed = useEditor.getState();
  const engine = ed.engine;
  if (ed.busy) return false;
  if (!engine) {
    toast('문서를 아직 여는 중이에요. 잠시 뒤에 다시 시도해 주세요.', 'error');
    return false;
  }

  const avail = aiAvailability(useAuth.getState().me, useSettings.getState().aiEnabled);
  if (!avail.ok) {
    toast(avail.message, 'error');
    return false;
  }
  if (!(await ensureConsent())) return false;

  // 이전 대화(이번 요청 제외)를 맥락으로 함께 보낸다.
  const history = ed.thread
    .filter((m) => !m.tone)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));

  ed.pushMsg({ role: 'user', content: userMessage });
  ed.setBusy(true);
  try {
    const document = await engine.summarize();
    const max = useAuth.getState().me?.maxDocChars ?? MAX_DOC_CHARS;
    const chars = totalChars(document);
    if (chars > max) {
      ed.pushMsg({
        role: 'assistant',
        tone: 'error',
        content: `문서가 너무 길어요(${chars.toLocaleString('ko-KR')}자). AI는 한 번에 ${max.toLocaleString('ko-KR')}자까지 볼 수 있어요. 문서를 나누어 시도해 주세요.`,
      });
      return false;
    }

    const res = await postPropose({ ...opts, document, history });
    useAuth.getState().setQuota(res.quota);
    const added = useEditor.getState().addProposals(res.proposals);
    useEditor.getState().pushMsg({
      role: 'assistant',
      content: res.reply,
      tone: res.demo ? 'demo' : undefined,
      hasProposals: added > 0,
    });
    return true;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 429)) void useAuth.getState().refresh();
    useEditor.getState().pushMsg({ role: 'assistant', tone: 'error', content: errorText(e) });
    return false;
  } finally {
    useEditor.getState().setBusy(false);
  }
}

/** AI 대화 탭: 사용자가 시킨 말을 AI 에게 보낸다. */
export async function askAi(instruction: string): Promise<boolean> {
  const text = instruction.trim();
  if (!text) return false;
  return callAi({ mode: 'chat', instruction: text }, text);
}

/** 서식 점검 탭(내 규칙): 말로 적은 규칙에 맞춰 AI 가 서식 변경을 제안한다. */
export async function runRulesWithAi(): Promise<boolean> {
  const { rulesText } = useEditor.getState();
  if (!rulesText.trim()) {
    toast('먼저 규칙을 적어 주세요.', 'error');
    return false;
  }
  const ok = await callAi({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: rulesText.trim() }, '내 규칙에 맞게 서식을 점검해 줘.');
  if (ok) useEditor.getState().setTab('changes');
  return ok;
}

/** 서식 점검(문서 안 일관성): AI 없이 바로 계산한다. */
export async function runConsistency(): Promise<void> {
  const { engine } = useEditor.getState();
  if (!engine || !engine.canFormat) {
    useEditor.getState().setConsistency(null);
    return;
  }
  const summary = await engine.summarize();
  useEditor.getState().setConsistency(analyzeConsistency(summary));
}

/** 점검에서 찾은 곳을 변경 내역의 제안으로 올린다(AI 사용 없음). */
export function postConsistencyProposals(): number {
  const ed = useEditor.getState();
  const result = ed.consistency;
  if (!result || result.findings.length === 0) return 0;
  const added = ed.addProposals(result.findings.map((f) => f.proposal));
  if (added > 0) {
    ed.setTab('changes');
    toast(`${added}개를 변경 내역에 올렸어요. 적용하기 전에는 문서가 바뀌지 않아요.`);
  } else {
    toast('이미 변경 내역에 올라와 있어요.');
  }
  return added;
}

/** 기준 문서(양식)를 읽어 역할별 대표 서식을 뽑아 둔다. */
export async function loadReference(file: File): Promise<boolean> {
  const check = checkUpload(file);
  if (!check.ok) {
    toast(check.message, 'error');
    return false;
  }
  try {
    const summary = await summarizeBlob(check.kind, file);
    const profile = buildProfile(summary, file.name);
    if (profile.groups.length === 0) {
      toast('이 파일에서 서식 정보를 찾지 못했어요.', 'error');
      return false;
    }
    useEditor.getState().setReference({ name: file.name, profile });
    return true;
  } catch (e) {
    toast(errorText(e), 'error');
    return false;
  }
}

/** 기준 문서의 서식에 맞추는 제안을 만든다(AI 사용 없음). */
export async function runReference(): Promise<number> {
  const { engine, reference } = useEditor.getState();
  if (!engine || !reference) return 0;
  const summary = await engine.summarize();
  const proposals = compareToProfile(summary, reference.profile);
  if (proposals.length === 0) {
    toast('기준 문서와 다른 곳을 찾지 못했어요.');
    return 0;
  }
  const added = useEditor.getState().addProposals(proposals);
  useEditor.getState().setTab('changes');
  toast(`${added}개를 변경 내역에 올렸어요. 적용하기 전에는 문서가 바뀌지 않아요.`);
  return added;
}
