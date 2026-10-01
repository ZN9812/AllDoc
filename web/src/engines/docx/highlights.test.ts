import { describe, expect, it } from 'vitest';
import { resolveSpans } from './highlights';
import type { BlockLike } from './model';

const blocks: BlockLike[] = [
  { nodeId: 'a', type: 'paragraph', text: '몇일 뒤에 만나요 몇일' },
  { nodeId: 'b', type: 'table', text: '' },
  { nodeId: 'c', type: 'heading', text: '제목' },
  { nodeId: 'd', type: 'paragraph', text: '' },
];

describe('resolveSpans', () => {
  it('고칠 글을 찾으면 그 글(처음 나오는 곳)만 가리킨다', () => {
    expect(resolveSpans([{ paragraph: 0, find: '몇일' }], blocks)).toEqual([{ blockId: 'a', start: 0, end: 2 }]);
  });

  it('글을 못 찾거나 정해지지 않았으면 문단 전체를 가리킨다', () => {
    expect(resolveSpans([{ paragraph: 0, find: '없는글' }, { paragraph: 2 }], blocks)).toEqual([
      { blockId: 'a', start: 0, end: 12 },
      { blockId: 'c', start: 0, end: 2 },
    ]);
  });

  it('없는 문단, 글이 아닌 블록, 빈 문단은 건너뛴다', () => {
    expect(resolveSpans([{ paragraph: 9 }, { paragraph: 1 }, { paragraph: 3 }, { paragraph: -1 }], blocks)).toEqual([]);
  });

  it('같은 범위는 한 번만 담는다', () => {
    expect(resolveSpans([{ paragraph: 2 }, { paragraph: 2 }], blocks)).toHaveLength(1);
  });
});
