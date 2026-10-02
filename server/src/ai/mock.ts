// 실제 AI 없이 정해진 규칙으로 제안을 만드는 데모/개발용 연결부.
// 화면 흐름(제안 → 적용/취소/되돌리기)을 API 키 없이 시험하고 보여 주려는 것이며, 실제 AI 의 품질을 대신하지 않는다.
import { eunNeun, euro, eulReul, iGa, isFormatKind, type DocSummary } from '@alldoc/shared';
import type { RawOp, RawProposal } from './schema';
import type { AiProvider, ProposeInput, ProviderResult } from './types';

/** 틀린 말 → 맞는 말(사전을 미리 정해 둔 오탈자만 다룬다) */
const TYPOS: Array<[wrong: string, right: string]> = [
  ['되요', '돼요'],
  ['할려고', '하려고'],
  ['몇일', '며칠'],
  ['오랫만', '오랜만'],
  ['웬지', '왠지'],
  ['설레임', '설렘'],
  ['금새', '금세'],
  ['어떻해', '어떡해'],
];

const FONTS = ['함초롬바탕', '함초롬돋움', '나눔명조', '나눔고딕', '맑은 고딕', 'Times New Roman', 'Calibri', 'Arial', '바탕', '돋움', '굴림'];

/** 낱말 뒤에 붙일 조사만 돌려준다(따옴표 안의 낱말 기준). */
function josaOf(word: string, kind: 'eunNeun' | 'euro' | 'iGa' | 'eulReul'): string {
  const f = { eunNeun, euro, iGa, eulReul }[kind];
  return f(word).slice(word.length);
}

/**
 * 서식 규칙은 표 칸·머리말·꼬리말·각주·미주·글상자·캡션 안의 문단에는 적용하지 않는다(실제 AI 에게도 같은 원칙을 프롬프트로 알린다). 맞춤법은 그곳에도 적용한다.
 * 다만 규칙에 그곳의 이름("표", "머리말", "꼬리말", "각주", "미주", "글상자", "캡션")이 적혀 있으면 사용자가 언급한 것이므로 그곳도 포함한다(프롬프트의 원칙과 같다).
 */
const formatTargets = (doc: DocSummary, rules: string) =>
  doc.paragraphs.filter((p) => {
    if (p.cell) return rules.includes('표');
    if (p.area) {
      const names: Record<string, string[]> = { header: ['머리말'], footer: ['꼬리말'], footnote: ['각주'], endnote: ['미주', '각주'], textbox: ['글상자'], caption: ['캡션'] };
      return (names[p.area.kind] ?? []).some((n) => rules.includes(n));
    }
    return true;
  });

const blankOp: RawOp = {
  type: 'replaceText',
  paragraph: 0,
  find: null,
  replace: null,
  fontFamily: null,
  fontSizePt: null,
  bold: null,
  italic: null,
  underline: null,
  align: null,
  lineSpacingPct: null,
};

const replaceOp = (paragraph: number, find: string, replace: string): RawOp => ({ ...blankOp, type: 'replaceText', paragraph, find, replace });

function spelling(doc: DocSummary): RawProposal[] {
  const out: RawProposal[] = [];
  for (const [wrong, right] of TYPOS) {
    const ops = doc.paragraphs.filter((p) => p.text.includes(wrong)).map((p) => replaceOp(p.index, wrong, right));
    if (ops.length === 0) continue;
    out.push({
      category: 'spelling',
      title: `"${wrong}" 고치기`,
      description: `"${wrong}"${josaOf(wrong, 'eunNeun')} 표준어가 아니에요. "${right}"${josaOf(right, 'euro')} 고칩니다. (${ops.length}곳)`,
      before: wrong,
      after: right,
      ops,
    });
  }
  const spaced = doc.paragraphs.filter((p) => p.text.includes('  ')).map((p) => replaceOp(p.index, '  ', ' '));
  if (spaced.length > 0) {
    out.push({
      category: 'spelling',
      title: '겹친 띄어쓰기 줄이기',
      description: `띄어쓰기가 두 번 연속된 곳을 한 번으로 줄입니다. (${spaced.length}곳)`,
      before: '두 칸',
      after: '한 칸',
      ops: spaced,
    });
  }
  return out;
}

/** 내 규칙 글에서 글꼴·크기·줄 간격을 읽어 어긋난 문단을 맞추는 제안을 만든다. */
function rulesProposals(doc: DocSummary, rules: string): RawProposal[] {
  const out: RawProposal[] = [];
  const font = [...FONTS].sort((a, b) => b.length - a.length).find((f) => rules.includes(f));
  const size = /(\d+(?:\.\d+)?)\s*(?:pt|포인트)/i.exec(rules)?.[1];
  const spacing = /줄\s*간격\s*(\d+)\s*%/.exec(rules)?.[1];

  if (font) {
    const ops = formatTargets(doc, rules).filter((p) => p.char.fontFamily && p.char.fontFamily !== font).map((p) => ({ ...blankOp, type: 'setCharStyle' as const, paragraph: p.index, fontFamily: font }));
    if (ops.length > 0) out.push({ category: 'format', title: `글꼴을 ${euro(font)}`, description: `규칙에 적힌 글꼴과 다른 문단 ${ops.length}곳을 맞춥니다.`, before: '다른 글꼴', after: font, ops });
  }
  if (size) {
    const pt = Number(size);
    const ops = formatTargets(doc, rules).filter((p) => p.char.fontSizePt != null && p.char.fontSizePt !== pt).map((p) => ({ ...blankOp, type: 'setCharStyle' as const, paragraph: p.index, fontSizePt: pt }));
    if (ops.length > 0) out.push({ category: 'format', title: `글자 크기를 ${pt}pt로`, description: `규칙에 적힌 크기와 다른 문단 ${ops.length}곳을 맞춥니다.`, before: '다른 크기', after: `${pt}pt`, ops });
  }
  if (spacing) {
    const pct = Number(spacing);
    const ops = formatTargets(doc, rules).filter((p) => p.para.lineSpacingPct != null && p.para.lineSpacingPct !== pct).map((p) => ({ ...blankOp, type: 'setParaStyle' as const, paragraph: p.index, lineSpacingPct: pct }));
    if (ops.length > 0) out.push({ category: 'format', title: `줄 간격을 ${pct}%로`, description: `규칙에 적힌 줄 간격과 다른 문단 ${ops.length}곳을 맞춥니다.`, before: '다른 간격', after: `${pct}%`, ops });
  }
  return out;
}

export class MockProvider implements AiProvider {
  readonly id = 'mock';
  readonly demo = true;

  async propose({ request }: ProposeInput): Promise<ProviderResult> {
    const doc = request.document;

    if (request.mode === 'format_check') {
      if (!isFormatKind(doc.kind)) return { reply: '(데모) 이 형식은 서식을 바꿀 수 없어요.', proposals: [] };
      const proposals = request.criteria === 'rules' && request.rulesText ? rulesProposals(doc, request.rulesText) : [];
      return {
        reply: proposals.length > 0 ? `(데모) 규칙과 다른 곳 ${proposals.length}가지를 찾았어요. 변경 내역에서 확인하세요.` : '(데모) 규칙에서 읽을 수 있는 글꼴·크기·줄 간격이 없거나, 이미 모두 맞아요. 예: "본문은 맑은 고딕 11pt, 줄 간격 160%"',
        proposals,
      };
    }

    const proposals = spelling(doc);
    return {
      reply:
        proposals.length > 0
          ? `(데모) 맞춤법·띄어쓰기 ${proposals.length}가지를 찾았어요. 변경 내역에서 하나씩 적용하거나 취소할 수 있어요. 이 답변은 실제 AI가 아닌 예시예요.`
          : '(데모) 미리 정해 둔 오탈자 목록에서는 고칠 곳을 찾지 못했어요. 이 답변은 실제 AI가 아닌 예시예요.',
      proposals,
    };
  }
}
