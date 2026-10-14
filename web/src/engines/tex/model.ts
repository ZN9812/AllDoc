// LaTeX 프로젝트의 순수 계산 부분(AI 에 보낼 블록 요약, 제안 적용, 표시 범위). 화면(TexEngine)과 분리해 시험한다.
// 블록 나누기는 서버 검증과 같은 shared/src/tex/chunk.ts 를 쓴다.
import { slotOf, splitFile, textGuard, type DocSummary, type Op, type ParagraphInfo, type TexBlock } from '@alldoc/shared';
import { stale, unsupported } from '../applyOps';
import type { ApplyFailure } from '../types';

/** 파일 → 파일칸. 프로젝트를 열 때 경로 순서로 정하고, 새 파일은 다음 칸을 받는다(이미 쓴 칸은 다시 쓰지 않는다). */
export class SlotTable {
  private readonly byPath = new Map<string, number>();
  private next = 0;

  constructor(paths: string[] = []) {
    for (const p of [...paths].sort()) this.slotFor(p);
  }

  slotFor(path: string): number {
    let s = this.byPath.get(path);
    if (s === undefined) {
      s = this.next++;
      this.byPath.set(path, s);
    }
    return s;
  }

  pathOf(slot: number): string | undefined {
    for (const [p, s] of this.byPath) if (s === slot) return p;
    return undefined;
  }

  /** 이름을 바꾸면 새 칸을 받는다(옛 이름을 가리키던 제안은 낡은 것이 된다). */
  forget(path: string): void {
    this.byPath.delete(path);
  }
}

export interface ProjectText {
  path: string;
  text: string;
}

export function blocksOf(f: ProjectText, slot: number, main: string): TexBlock[] {
  return splitFile(f.text, f.path, slot, f.path === main);
}

/** AI 에 보낼 문서 요약. verbatim 블록은 보내지 않는다. onlyLines 를 주면 그 파일의 그 줄 범위와 겹치는 블록만 보낸다. */
export function summarizeProject(files: ProjectText[], slots: SlotTable, main: string, onlyLines?: { path: string; from: number; to: number }): DocSummary {
  const paragraphs: ParagraphInfo[] = [];
  for (const f of files) {
    if (onlyLines && f.path !== onlyLines.path) continue;
    for (const b of blocksOf(f, slots.slotFor(f.path), main)) {
      if (b.role === 'verbatim') continue;
      if (onlyLines && (b.endLine < onlyLines.from || b.line > onlyLines.to)) continue;
      paragraphs.push({ index: b.index, text: b.text, char: {}, para: {}, src: { file: b.file, line: b.line, role: b.role } });
    }
  }
  return { kind: 'tex', paragraphs };
}

export type TexOpResult = { ok: true; text: string; inverse: Op; from: number; to: number; insert: string } | ApplyFailure;

/**
 * replaceText 하나를 파일 글에 적용한다. 블록 글의 지문이 다르면(그 사이 고쳤으면) 적용하지 않는다.
 * 돌려주는 from·to·insert 는 파일 글 기준 바뀐 자리(편집기에 그대로 넘긴다).
 */
export function applyTexOp(f: ProjectText, slot: number, main: string, op: Op): TexOpResult {
  if (op.type !== 'replaceText') return unsupported('LaTeX 원고에서는 서식을 바꿀 수 없어요. 글만 고쳐요.');
  if (slotOf(op.paragraph) !== slot) return stale('다른 파일의 블록이에요.');
  const block = blocksOf(f, slot, main).find((b) => b.index === op.paragraph);
  if (!block) return stale('원고가 바뀌어 해당 블록을 찾을 수 없어요.');
  if (op.guard !== undefined && op.guard !== textGuard(block.text)) return stale('원고가 바뀌어 이 제안을 적용할 수 없어요. 다시 물어봐 주세요.');
  let at: number;
  if (op.find === '') {
    if (op.at === undefined || op.at > block.text.length) return stale('끼워 넣을 위치를 찾을 수 없어요.');
    at = op.at;
  } else if (op.at !== undefined && block.text.startsWith(op.find, op.at)) {
    at = op.at;
  } else {
    at = block.text.indexOf(op.find);
    if (at < 0) return stale('원고가 바뀌어 고칠 글을 찾을 수 없어요.');
  }
  const newBlock = block.text.slice(0, at) + op.replace + block.text.slice(at + op.find.length);
  const from = block.start + at;
  const to = from + op.find.length;
  return {
    ok: true,
    text: f.text.slice(0, from) + op.replace + f.text.slice(to),
    inverse: { type: 'replaceText', paragraph: op.paragraph, find: op.replace, replace: op.find, at, guard: textGuard(newBlock) },
    from,
    to,
    insert: op.replace,
  };
}

/**
 * 표시할 곳(블록 안의 find, 없으면 블록 전체)의 파일 글 기준 범위.
 * nth 는 같은 블록에서 같은 find 를 몇 번째로 가리키는지(0부터). 한 제안이 같은 글을 여러 번 고치면 앞에서부터 차례로 적용되므로 표시도 차례로 한다.
 */
export function rangeOfTarget(f: ProjectText, slot: number, main: string, target: { paragraph: number; find?: string }, nth = 0): [number, number] | null {
  if (slotOf(target.paragraph) !== slot) return null;
  const block = blocksOf(f, slot, main).find((b) => b.index === target.paragraph);
  if (!block) return null;
  if (target.find) {
    let at = block.text.indexOf(target.find);
    for (let i = 0; i < nth && at >= 0; i++) at = block.text.indexOf(target.find, at + target.find.length);
    return at < 0 ? null : [block.start + at, block.start + at + target.find.length];
  }
  return [block.start, block.end];
}
