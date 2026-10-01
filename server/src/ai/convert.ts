// 모델이 돌려준 "평평한" 제안을 문서와 대조해 엄격한 제안(Proposal)으로 바꾼다.
// 문서에 없는 문단 번호, 문단에 없는 글, 말이 안 되는 서식 값이 하나라도 있는 제안은 통째로 버린다(일부만 적용되면 카드 설명과 달라지므로).
import { randomUUID } from 'node:crypto';
import { isFormatKind, type CharStyle, type DocSummary, type Op, type ParaStyle, type Proposal } from '@alldoc/shared';
import type { RawOp, RawProposal } from './schema';

export const MAX_PROPOSALS = 30;
const MAX_OPS_PER_PROPOSAL = 60;

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function convertOp(raw: RawOp, doc: DocSummary, byIndex: Map<number, string>): Op | null {
  const text = byIndex.get(raw.paragraph);
  if (text === undefined) return null;

  switch (raw.type) {
    case 'replaceText': {
      if (!raw.find || raw.replace === null) return null;
      if (!text.includes(raw.find) || raw.find === raw.replace) return null;
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
}

export function toProposals(raw: RawProposal[], doc: DocSummary, newId: () => string = () => `ai-${randomUUID().slice(0, 8)}`): ConvertResult {
  const byIndex = new Map(doc.paragraphs.map((p) => [p.index, p.text]));
  const proposals: Proposal[] = [];
  let dropped = 0;

  for (const r of raw) {
    if (proposals.length >= MAX_PROPOSALS) {
      dropped++;
      continue;
    }
    const title = r.title.trim();
    if (r.ops.length === 0 || r.ops.length > MAX_OPS_PER_PROPOSAL || title.length === 0) {
      dropped++;
      continue;
    }
    const ops = r.ops.map((o) => convertOp(o, doc, byIndex));
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
  return { proposals, dropped };
}
