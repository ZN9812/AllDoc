// "AI 가 고칠 곳"을 Word 문서 위에 겹쳐 그리기 위한 계산. 문단 번호(+ 고칠 글)를 문서 안의 글 범위로 바꾼다.
import type { HighlightTarget } from '../types';
import type { Story } from './areas';
import { isTextBlock, type BlockLike } from './model';

export interface Span {
  blockId: string;
  start: number;
  end: number;
  /** 머리말·꼬리말·각주·미주 안의 글이면 그 이야기. 편집기가 문서 위의 자리를 찾을 때 함께 넘긴다. */
  story?: Story;
}

/** 고칠 글을 문단에서 찾으면 그 글만, 못 찾거나 글이 정해지지 않았으면 문단 전체를 가리킨다. 같은 범위는 한 번만. */
export function resolveSpans(targets: HighlightTarget[], blocks: BlockLike[]): Span[] {
  const seen = new Set<string>();
  const out: Span[] = [];
  for (const t of targets) {
    const b = blocks[t.paragraph];
    if (!b || !isTextBlock(b) || b.text.length === 0) continue;
    let start = 0;
    let end = b.text.length;
    if (t.find) {
      const i = b.text.indexOf(t.find);
      if (i >= 0) {
        start = i;
        end = i + t.find.length;
      }
    }
    const key = `${b.nodeId}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ blockId: b.nodeId, start, end, ...(b.area ? { story: b.area.story } : {}) });
  }
  return out;
}
