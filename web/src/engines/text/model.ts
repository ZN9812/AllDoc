// 글 문서(TXT·MD)의 순수 계산 부분. 화면과 분리해서 시험한다.
import { textGuard, type DocKind, type DocSummary, type Op } from '@alldoc/shared';
import type { ApplyFailure } from '../types';
import { stale, unsupported } from '../applyOps';

/** 한 줄을 한 문단으로 본다. 문단 번호(index)는 줄 번호(0부터)다. */
export function splitLines(text: string): string[] {
  return text.split('\n');
}

export function summarizeText(text: string, kind: DocKind): DocSummary {
  const paragraphs = splitLines(text)
    .map((line, index) => ({ index, text: line, char: {}, para: {} }))
    .filter((p) => p.text.trim().length > 0);
  return { kind, paragraphs };
}

export type TextOpResult = { ok: true; text: string; inverse: Op } | ApplyFailure;

export function applyTextOp(text: string, op: Op): TextOpResult {
  if (op.type !== 'replaceText') return unsupported('글 문서(TXT·MD)에서는 서식을 바꿀 수 없어요.');

  const lines = splitLines(text);
  const line = lines[op.paragraph];
  if (line === undefined) return stale('문서가 바뀌어 해당 문단을 찾을 수 없어요.');
  if (op.guard !== undefined && op.guard !== textGuard(line)) return stale('문서가 바뀌어 이 제안을 적용할 수 없어요. 다시 점검해 주세요.');

  let at: number;
  if (op.find === '') {
    if (op.at === undefined || op.at > line.length) return stale('끼워 넣을 위치를 찾을 수 없어요.');
    at = op.at;
  } else if (op.at !== undefined && line.startsWith(op.find, op.at)) {
    at = op.at;
  } else {
    at = line.indexOf(op.find);
    if (at < 0) return stale('문서가 바뀌어 고칠 글을 찾을 수 없어요.');
  }

  lines[op.paragraph] = line.slice(0, at) + op.replace + line.slice(at + op.find.length);
  return {
    ok: true,
    text: lines.join('\n'),
    inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, at, guard: textGuard(lines[op.paragraph] ?? '') },
  };
}

/** 줄 번호와 글로 문서 안 글자 위치(범위)를 구한다. find 가 없으면 줄 전체. */
export function rangeOf(text: string, target: { paragraph: number; find?: string }): [number, number] | null {
  const lines = splitLines(text);
  const line = lines[target.paragraph];
  if (line === undefined) return null;
  let start = 0;
  for (let i = 0; i < target.paragraph; i++) start += (lines[i]?.length ?? 0) + 1;
  if (target.find) {
    const at = line.indexOf(target.find);
    if (at < 0) return null;
    return [start + at, start + at + target.find.length];
  }
  if (line.length === 0) return null;
  return [start, start + line.length];
}

export interface Segment {
  text: string;
  mark: false | 'pending' | 'focus';
}

/** 글을 "표시할 곳"과 아닌 곳으로 잘라, 화면에 청록색 표시를 그릴 수 있게 한다. */
export function segmentText(
  text: string,
  pending: Array<{ paragraph: number; find?: string }>,
  focus: Array<{ paragraph: number; find?: string }>,
): Segment[] {
  const marks: Array<{ from: number; to: number; kind: 'pending' | 'focus' }> = [];
  for (const t of pending) {
    const r = rangeOf(text, t);
    if (r) marks.push({ from: r[0], to: r[1], kind: 'pending' });
  }
  for (const t of focus) {
    const r = rangeOf(text, t);
    if (r) marks.push({ from: r[0], to: r[1], kind: 'focus' });
  }
  marks.sort((a, b) => a.from - b.from || b.to - a.to);

  const out: Segment[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.from < pos) {
      // 겹치는 표시: 이미 그린 범위 안이면 건너뛰고, 걸쳐 있으면 뒷부분만 그린다.
      if (m.to <= pos) {
        if (m.kind === 'focus') {
          // 진하게 표시해야 하는 범위가 이미 지나갔다면 해당 구간을 다시 나눠 focus 로 바꾼다.
          return segmentFocusFirst(text, marks);
        }
        continue;
      }
      out.push({ text: text.slice(pos, m.to), mark: m.kind });
      pos = m.to;
      continue;
    }
    if (m.from > pos) out.push({ text: text.slice(pos, m.from), mark: false });
    out.push({ text: text.slice(m.from, m.to), mark: m.kind });
    pos = m.to;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out;
}

// 겹침이 있을 때는 글자 하나씩 표시 종류를 정하고(focus 가 pending 보다 우선), 같은 종류끼리 묶는다.
function segmentFocusFirst(text: string, marks: Array<{ from: number; to: number; kind: 'pending' | 'focus' }>): Segment[] {
  const kinds: Array<false | 'pending' | 'focus'> = new Array<false | 'pending' | 'focus'>(text.length).fill(false);
  for (const m of marks) {
    for (let i = m.from; i < m.to && i < text.length; i++) {
      if (m.kind === 'focus' || kinds[i] === false) kinds[i] = m.kind;
    }
  }
  const out: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    const k = kinds[i] ?? false;
    let j = i + 1;
    while (j < text.length && (kinds[j] ?? false) === k) j++;
    out.push({ text: text.slice(i, j), mark: k });
    i = j;
  }
  return out;
}
