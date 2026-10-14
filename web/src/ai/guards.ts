import { areaLabel, areaName, placeLabel, sourceLabel, textGuard, type AreaPlace, type CellPlace, type DocSummary, type Proposal, type SourcePlace } from '@alldoc/shared';

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

type Place = CellPlace | AreaPlace;
const isArea = (p: Place): p is AreaPlace => 'kind' in p;

/**
 * 제안이 가리키는 문단들이 본문 밖(표 칸, 머리말·꼬리말·각주·미주)에 있으면 사람이 읽을 위치 문구를 만든다(본문뿐이면 undefined).
 * 한 곳이면 그 위치("표 1 · 2행 1열", "각주 3"), 여러 곳이면 같은 표·같은 종류끼리 묶어 곳 수를 쓴다.
 */
export function placeOfParagraphs(paragraphs: number[], places: ReadonlyMap<number, Place>): string | undefined {
  const unique = [...new Set(paragraphs)];
  const outside = unique.filter((i) => places.has(i));
  if (outside.length === 0) return undefined;
  const found = outside.map((i) => places.get(i) as Place);
  if (unique.length === 1) {
    const only = found[0] as Place;
    return isArea(only) ? areaLabel(only) : placeLabel(only);
  }

  const cells = found.filter((p): p is CellPlace => !isArea(p));
  if (cells.length === found.length) {
    if (outside.length < unique.length) return `표 안 ${outside.length}곳 포함`;
    const tables = new Set(cells.map((c) => c.table));
    return tables.size === 1 ? `표 ${[...tables][0]} 안 ${outside.length}곳` : `표 안 ${outside.length}곳`;
  }
  // 머리말·꼬리말·각주·미주가 든 경우: 종류 이름을 나열한다. 예: "각주 2곳", "머리말·꼬리말 2곳 포함"
  const names = [...new Set(found.map((p) => (isArea(p) ? areaName(p) : '표')))].join('·');
  return `${names} ${outside.length}곳${outside.length < unique.length ? ' 포함' : ''}`;
}

/** LaTeX 원고의 위치 문구: 한 블록이면 "main.tex 42행", 한 파일 여러 블록이면 "main.tex 3곳", 여러 파일이면 "파일 2개 4곳". */
export function sourceOfParagraphs(paragraphs: number[], srcs: ReadonlyMap<number, SourcePlace>): string | undefined {
  const found = [...new Set(paragraphs)].map((i) => srcs.get(i)).filter((s): s is SourcePlace => s !== undefined);
  const first = found[0];
  if (!first) return undefined;
  if (found.length === 1) return sourceLabel(first);
  const files = new Set(found.map((s) => s.file));
  return files.size === 1 ? `${first.file} ${found.length}곳` : `파일 ${files.size}개 ${found.length}곳`;
}

/** 본문 밖의 글(표 칸, 머리말·꼬리말·각주·미주)을 고치는 제안에 위치 문구를 붙인다(변경 내역 카드에 보여 준다). 본문뿐인 문서에서는 그대로 돌려준다. LaTeX 원고는 늘 파일·줄을 붙인다. */
export function attachPlaces(proposals: Proposal[], summary: DocSummary): Proposal[] {
  const srcs = new Map<number, SourcePlace>();
  for (const p of summary.paragraphs) if (p.src) srcs.set(p.index, p.src);
  if (srcs.size > 0) {
    return proposals.map((p) => {
      const place = sourceOfParagraphs(
        p.ops.map((op) => op.paragraph),
        srcs,
      );
      return place === undefined ? p : { ...p, place };
    });
  }
  const places = new Map<number, Place>();
  for (const p of summary.paragraphs) {
    const where = p.cell ?? p.area;
    if (where) places.set(p.index, where);
  }
  if (places.size === 0) return proposals;
  return proposals.map((p) => {
    const place = placeOfParagraphs(
      p.ops.map((op) => op.paragraph),
      places,
    );
    return place === undefined ? p : { ...p, place };
  });
}
