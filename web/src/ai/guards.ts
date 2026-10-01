import { placeLabel, textGuard, type CellPlace, type DocSummary, type Proposal } from '@alldoc/shared';

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

/** 제안이 가리키는 문단들이 표 칸 안에 있으면 사람이 읽을 위치 문구를 만든다(표 밖뿐이면 undefined). */
export function placeOfParagraphs(paragraphs: number[], cells: ReadonlyMap<number, CellPlace>): string | undefined {
  const unique = [...new Set(paragraphs)];
  const inCells = unique.filter((i) => cells.has(i));
  if (inCells.length === 0) return undefined;
  if (unique.length === 1) return placeLabel(cells.get(unique[0] as number) as CellPlace);
  if (inCells.length < unique.length) return `표 안 ${inCells.length}곳 포함`;
  const tables = new Set(inCells.map((i) => (cells.get(i) as CellPlace).table));
  return tables.size === 1 ? `표 ${[...tables][0]} 안 ${inCells.length}곳` : `표 안 ${inCells.length}곳`;
}

/** 표 안의 글을 고치는 제안에 위치 문구를 붙인다(변경 내역 카드에 보여 준다). 표 안의 글이 없는 문서에서는 그대로 돌려준다. */
export function attachPlaces(proposals: Proposal[], summary: DocSummary): Proposal[] {
  const cells = new Map(summary.paragraphs.flatMap((p) => (p.cell ? [[p.index, p.cell] as const] : [])));
  if (cells.size === 0) return proposals;
  return proposals.map((p) => {
    const place = placeOfParagraphs(
      p.ops.map((op) => op.paragraph),
      cells,
    );
    return place === undefined ? p : { ...p, place };
  });
}
