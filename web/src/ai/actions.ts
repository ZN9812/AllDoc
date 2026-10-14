// 화면의 버튼이 부르는 AI·서식 점검 동작. 모든 결과는 "제안"으로 변경 내역에 올라가고, 사용자가 적용하기 전에는 문서가 바뀌지 않는다.
import { MAX_DOC_CHARS, type AiRequest, type CompileContext, type DocSummary } from '@alldoc/shared';
import { useEditor } from '../editor/store';
import { useTex, errorCount } from '../editor/tex/store';
import { summarizeBlob } from '../engines/headless';
import type { SummarizeOptions } from '../engines/types';
import { checkUpload } from '../lib/files';
import { aiAvailability, useAuth } from '../state/auth';
import { ensureConsent } from '../state/consent';
import { useSettings } from '../state/settings';
import { toast } from '../state/toast';
import { ApiError, postPropose } from './client';
import { analyzeConsistency, buildProfile, compareToProfile } from './consistency';
import { attachGuards, attachPlaces } from './guards';

const totalChars = (s: DocSummary): number => s.paragraphs.reduce((n, p) => n + p.text.length, 0);

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return '알 수 없는 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.';
}

type CallOptions = Pick<AiRequest, 'mode' | 'instruction'> & Partial<Pick<AiRequest, 'criteria' | 'rulesText' | 'reference' | 'compile'>>;

/** 서버에 AI 요청을 보내고 결과를 대화와 변경 내역에 반영한다. 성공하면 변경 내역에 올린 제안 번호들, 실패하면 null. */
async function callAi(opts: CallOptions, userMessage: string, scope?: SummarizeOptions): Promise<string[] | null> {
  const ed = useEditor.getState();
  const engine = ed.engine;
  if (ed.busy) return null;
  if (!engine) {
    toast('문서를 아직 여는 중이에요. 잠시 뒤에 다시 시도해 주세요.', 'error');
    return null;
  }

  const avail = aiAvailability(useAuth.getState().me, useSettings.getState().aiEnabled);
  if (!avail.ok) {
    toast(avail.message, 'error');
    return null;
  }
  if (!(await ensureConsent())) return null;

  // 이전 대화(이번 요청 제외)를 맥락으로 함께 보낸다.
  const history = ed.thread
    .filter((m) => !m.tone)
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content }));

  ed.pushMsg({ role: 'user', content: userMessage });
  ed.setBusy(true);
  try {
    // LaTeX 프로젝트는 고른 범위(지금 파일·선택 영역·프로젝트 전체)만 보낸다.
    const document = await engine.summarize(engine.kind === 'tex' ? (scope ?? { scope: ed.texScope }) : undefined);
    if (engine.kind === 'tex' && document.paragraphs.length === 0) {
      ed.pushMsg({ role: 'assistant', tone: 'error', content: '보낼 원고가 없어요. .tex·.bib 파일을 열거나 범위를 바꿔 주세요(verbatim 안의 글은 보내지 않아요).' });
      return null;
    }
    const max = useAuth.getState().me?.maxDocChars ?? MAX_DOC_CHARS;
    const chars = totalChars(document);
    if (chars > max) {
      ed.pushMsg({
        role: 'assistant',
        tone: 'error',
        content:
          engine.kind === 'tex'
            ? `보낼 원고가 너무 길어요(${chars.toLocaleString('ko-KR')}자). AI는 한 번에 ${max.toLocaleString('ko-KR')}자까지 볼 수 있어요. 범위를 "지금 파일"이나 "선택 영역"으로 줄여 주세요.`
            : `문서가 너무 길어요(${chars.toLocaleString('ko-KR')}자). AI는 한 번에 ${max.toLocaleString('ko-KR')}자까지 볼 수 있어요. 문서를 나누어 시도해 주세요.`,
      });
      return null;
    }

    const res = await postPropose({ ...opts, document, history });
    useAuth.getState().setQuota(res.quota);
    const proposals = attachPlaces(attachGuards(res.proposals, document), document);
    const added = useEditor.getState().addProposals(proposals);
    useEditor.getState().pushMsg({
      role: 'assistant',
      content: res.reply,
      tone: res.demo ? 'demo' : undefined,
      hasProposals: added > 0,
    });
    return proposals.map((p) => p.id);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 429)) void useAuth.getState().refresh();
    useEditor.getState().pushMsg({ role: 'assistant', tone: 'error', content: errorText(e) });
    return null;
  } finally {
    useEditor.getState().setBusy(false);
  }
}

/** AI 대화 탭: 사용자가 시킨 말을 AI 에게 보낸다. */
export async function askAi(instruction: string): Promise<boolean> {
  const text = instruction.trim();
  if (!text) return false;
  return (await callAi({ mode: 'chat', instruction: text }, text)) !== null;
}

/** 진단을 서버에 보낼 모양으로(개수·길이 제한은 shared/src/api.ts 의 CompileContextSchema) */
export function compileContext(r: { diagnostics: CompileContext['diagnostics']; logTail: string }): CompileContext {
  return { diagnostics: r.diagnostics.slice(0, 50), logExcerpt: r.logTail.slice(-8000) };
}

/**
 * 컴파일 탭의 "AI로 오류 고치기": 마지막 컴파일의 오류·로그와, 오류가 가리키는 파일과 주 파일의 원고를 보낸다.
 * 서버는 오류 근처 블록과 서문만 고치는 제안을 받는다(느슨한 검증, docs/LATEX.md).
 */
export async function fixTexErrors(): Promise<boolean> {
  const result = useTex.getState().result;
  if (!result || result.status === 'ok') {
    toast('고칠 컴파일 오류가 없어요.', 'error');
    return false;
  }
  const files = [...new Set(result.diagnostics.map((d) => d.file).filter((f): f is string => f !== null))];
  useEditor.getState().setTab('chat');
  const ids = await callAi({ mode: 'tex_fix', instruction: '컴파일 오류를 고쳐 줘.', compile: compileContext(result) }, 'AI로 오류 고치기', { files });
  if (ids === null) return false;
  // 적용한 뒤 다시 컴파일해 오류가 늘면 알린다.
  useTex.getState().setFixBaseline(errorCount(result), ids);
  if (ids.length > 0) useEditor.getState().setTab('changes');
  return true;
}

/** 서식 점검 탭(내 규칙): 말로 적은 규칙에 맞춰 AI 가 서식 변경을 제안한다. */
export async function runRulesWithAi(): Promise<boolean> {
  const { rulesText } = useEditor.getState();
  if (!rulesText.trim()) {
    toast('먼저 규칙을 적어 주세요.', 'error');
    return false;
  }
  const ok = (await callAi({ mode: 'format_check', instruction: '', criteria: 'rules', rulesText: rulesText.trim() }, '내 규칙에 맞게 서식을 점검해 줘.')) !== null;
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
  const result = analyzeConsistency(summary);
  // 점검 결과의 제안에도 "본 문단 글의 지문"을 붙여, 나중에 문서가 바뀌었으면 적용을 거절하게 한다.
  const guarded = attachGuards(result.findings.map((f) => f.proposal), summary);
  useEditor.getState().setConsistency({ ...result, findings: result.findings.map((f, i) => ({ ...f, proposal: guarded[i] ?? f.proposal })) });
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
  const proposals = attachGuards(compareToProfile(summary, reference.profile), summary);
  if (proposals.length === 0) {
    toast('기준 문서와 다른 곳을 찾지 못했어요.');
    return 0;
  }
  const added = useEditor.getState().addProposals(proposals);
  useEditor.getState().setTab('changes');
  toast(`${added}개를 변경 내역에 올렸어요. 적용하기 전에는 문서가 바뀌지 않아요.`);
  return added;
}
