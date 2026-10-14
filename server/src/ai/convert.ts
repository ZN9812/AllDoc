// 모델이 돌려준 "평평한" 제안을 문서와 대조해 엄격한 제안(Proposal)으로 바꾼다.
// 문서에 없는 문단 번호, 문단에 없는 글, 말이 안 되는 서식 값이 하나라도 있는 제안은 통째로 버린다(일부만 적용되면 카드 설명과 달라지므로).
import { randomUUID } from 'node:crypto';
import {
  applyFirst,
  checkTexEdit,
  fixableBlocks,
  isFormatKind,
  mentionsMath,
  type AiTask,
  type CharStyle,
  type CompileContext,
  type DocSummary,
  type Op,
  type ParagraphInfo,
  type ParaStyle,
  type Proposal,
  type TexRule,
} from '@alldoc/shared';
import type { RawOp, RawProposal } from './schema';

export const MAX_PROPOSALS = 30;
const MAX_OPS_PER_PROPOSAL = 60;
/** 오류 고치기(tex_fix)는 작게 고치게 한다 */
export const MAX_TEX_FIX_OPS = 5;

/** LaTeX 제안 검사에 필요한 것(요청에서 온다) */
export interface TexContext {
  task: AiTask;
  instruction: string;
  compile?: CompileContext;
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** LaTeX 블록을 고치는 replaceText 를 규칙으로 검사한다(docs/LATEX.md "변경과 서버 검증"). 통과하면 null, 아니면 어긴 규칙 */
function checkTexOp(p: ParagraphInfo, find: string, replace: string, tex: TexContext, fixable: Set<number> | null): TexRule | null {
  const role = p.src?.role ?? 'body';
  const after = applyFirst(p.text, find, replace);
  if (after === null) return 'near';
  if (tex.task === 'tex_fix') {
    if (fixable && !fixable.has(p.index)) return 'near';
    return checkTexEdit({ mode: 'loose', role, before: p.text, after });
  }
  return checkTexEdit({ mode: 'strict', role, before: p.text, after, mathAllowed: mentionsMath(tex.instruction) });
}

function convertOp(raw: RawOp, doc: DocSummary, byIndex: Map<number, ParagraphInfo>, tex: TexContext | null, fixable: Set<number> | null, rejected: TexRule[]): Op | null {
  const para = byIndex.get(raw.paragraph);
  if (para === undefined) return null;
  const text = para.text;

  switch (raw.type) {
    case 'replaceText': {
      if (!raw.find || raw.replace === null) return null;
      if (!text.includes(raw.find) || raw.find === raw.replace) return null;
      if (doc.kind === 'tex') {
        const rule = checkTexOp(para, raw.find, raw.replace, tex ?? { task: 'tex_chat', instruction: '' }, fixable);
        if (rule) {
          rejected.push(rule);
          return null;
        }
      }
      return { type: 'replaceText', paragraph: raw.paragraph, find: raw.find, replace: raw.replace };
    }
    case 'setCharStyle': {
      if (!isFormatKind(doc.kind)) return null;
      const style: CharStyle = {};
      if (raw.fontFamily != null) {
        const name = raw.fontFamily.trim();
        if (name.length === 0 || name.length > 60) return null;
        style.fontFamily = name;
      }
      if (raw.fontSizePt != null) {
        if (!(raw.fontSizePt >= 1 && raw.fontSizePt <= 200)) return null;
        style.fontSizePt = Math.round(raw.fontSizePt * 2) / 2;
      }
      if (raw.bold != null) style.bold = raw.bold;
      if (raw.italic != null) style.italic = raw.italic;
      if (raw.underline != null) style.underline = raw.underline;
      return Object.keys(style).length > 0 ? { type: 'setCharStyle', paragraph: raw.paragraph, style } : null;
    }
    case 'setParaStyle': {
      if (!isFormatKind(doc.kind)) return null;
      const style: ParaStyle = {};
      if (raw.align != null) style.align = raw.align;
      if (raw.lineSpacingPct != null) {
        if (!(raw.lineSpacingPct >= 50 && raw.lineSpacingPct <= 500)) return null;
        style.lineSpacingPct = Math.round(raw.lineSpacingPct);
      }
      return Object.keys(style).length > 0 ? { type: 'setParaStyle', paragraph: raw.paragraph, style } : null;
    }
  }
}

export interface ConvertResult {
  proposals: Proposal[];
  /** 문서와 맞지 않아 버린 제안 수 */
  dropped: number;
  /** LaTeX 규칙을 어겨 버린 변경들의 규칙(원장·서버 기록용, 같은 것이 여러 번 나올 수 있다) */
  rejected: TexRule[];
}

export function toProposals(
  raw: RawProposal[],
  doc: DocSummary,
  newId: () => string = () => `ai-${randomUUID().slice(0, 8)}`,
  tex: TexContext | null = null,
): ConvertResult {
  const byIndex = new Map(doc.paragraphs.map((p) => [p.index, p]));
  const proposals: Proposal[] = [];
  const rejected: TexRule[] = [];
  let dropped = 0;
  // 오류 고치기: 고칠 수 있는 블록은 진단된 줄 근처와 서문뿐이다.
  const fixable =
    doc.kind === 'tex' && tex?.task === 'tex_fix'
      ? fixableBlocks(
          doc.paragraphs.filter((p) => p.src).map((p) => ({ index: p.index, file: p.src?.file ?? '', line: p.src?.line ?? 1, role: p.src?.role ?? 'body' })),
          tex.compile?.diagnostics.filter((d) => d.severity === 'error') ?? [],
        )
      : null;

  for (const r of raw) {
    if (proposals.length >= MAX_PROPOSALS) {
      dropped++;
      continue;
    }
    const title = r.title.trim();
    const maxOps = fixable ? MAX_TEX_FIX_OPS : MAX_OPS_PER_PROPOSAL;
    if (r.ops.length === 0 || r.ops.length > maxOps || title.length === 0) {
      dropped++;
      continue;
    }
    const ops = r.ops.map((o) => convertOp(o, doc, byIndex, tex, fixable, rejected));
    if (ops.some((o) => o === null)) {
      dropped++;
      continue;
    }
    const first = r.ops[0];
    proposals.push({
      id: newId(),
      category: r.category,
      title: clip(title, 60),
      description: clip(r.description.trim(), 300),
      before: clip(r.before.trim() || (first?.find ?? ''), 80),
      after: clip(r.after.trim() || (first?.replace ?? ''), 80),
      ops: ops as Op[],
    });
  }
  return { proposals, dropped, rejected };
}
