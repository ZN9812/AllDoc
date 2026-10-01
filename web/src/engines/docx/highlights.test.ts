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

  it('본문 밖(머리말·각주 등)의 글이면 그 이야기를 함께 담아, 편집기가 그 자리를 찾을 수 있게 한다', () => {
    const story = { kind: 'story', storyType: 'footnote', noteId: '3' } as const;
    const withNote: BlockLike[] = [...blocks, { nodeId: 'n', type: 'paragraph', text: ' 각주 몇일', area: { story, kind: 'footnote', part: 'word/footnotes.xml', number: 3 } }];
    expect(resolveSpans([{ paragraph: 4, find: '몇일' }, { paragraph: 0 }], withNote)).toEqual([
      { blockId: 'n', start: 4, end: 6, story },
      { blockId: 'a', start: 0, end: 12 },
    ]);
  });
});
