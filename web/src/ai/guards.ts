import { textGuard, type DocSummary, type Proposal } from '@alldoc/shared';

/**
 * 제안의 각 변경에 "제안을 만들 때 본 문단 글의 지문"을 붙인다.
 * 나중에 적용할 때 그 문단의 글이 달라졌다면(문단이 밀렸거나 직접 고쳤다면) 편집기 연결부가 적용을 거절한다.
 */
export function attachGuards(proposals: Proposal[], summary: DocSummary): Proposal[] {
  const text = new Map(summary.paragraphs.map((p) => [p.index, p.text]));
  return proposals.map((p) => ({
    ...p,
    ops: p.ops.map((op) => {
      const t = text.get(op.paragraph);
      return t === undefined ? op : { ...op, guard: textGuard(t) };
    }),
  }));
}
