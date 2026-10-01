import type { DocSummary, Op, Proposal } from '@alldoc/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAtomic } from '../engines/applyOps';
import { applyTextOp, summarizeText } from '../engines/text/model';
import type { EngineHandle, HighlightState } from '../engines/types';
import { useToasts } from '../state/toast';
import { computeHighlights, selectPendingCount, useEditor } from './store';

/** 글 모델 위에 올린 가짜 편집기. 실제 화면 없이 제안 흐름만 시험한다. */
function fakeEngine(initial: string) {
  let text = initial;
  const highlights: HighlightState[] = [];
  let release: (() => void) | null = null;
  const order: string[] = [];
  const handle: EngineHandle = {
    kind: 'txt',
    canFormat: false,
    getBlob: async () => new Blob([text]),
    exportOptions: () => [],
    summarize: async (): Promise<DocSummary> => summarizeText(text, 'txt'),
    apply: async (ops: Op[]) => {
      order.push(`start:${JSON.stringify(ops[0])}`);
      if (release === null && hold) await new Promise<void>((r) => (release = r));
      const result = await applyAtomic(async (op) => {
        const r = applyTextOp(text, op);
        if (!r.ok) return r;
        text = r.text;
        return { ok: true, inverse: r.inverse };
      }, ops);
      order.push('end');
      return result;
    },
    setHighlights: (h) => highlights.push(h),
  };
  let hold = false;
  return {
    handle,
    highlights,
    order,
    get text() {
      return text;
    },
    set text(v: string) {
      text = v;
    },
    holdFirst() {
      hold = true;
    },
    releaseFirst() {
      hold = false;
      release?.();
    },
  };
}

const replace = (id: string, paragraph: number, find: string, replaceWith: string): Proposal => ({
  id,
  category: 'spelling',
  title: `${find} 고치기`,
  description: '시험',
  before: find,
  after: replaceWith,
  ops: [{ type: 'replaceText', paragraph, find, replace: replaceWith }],
});

const item = (id: string) => useEditor.getState().items.find((i) => i.proposal.id === id);

let eng: ReturnType<typeof fakeEngine>;

beforeEach(() => {
  useEditor.getState().reset();
  useToasts.setState({ items: [] });
  eng = fakeEngine('제출기한을 지켜 주세요.\n자료를 보내 주세요.');
  useEditor.getState().setEngine(eng.handle);
});

describe('제안 목록', () => {
  it('제안을 올리면 "대기" 상태가 되고, 문서는 바뀌지 않는다', () => {
    const added = useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을')]);
    expect(added).toBe(1);
    expect(item('a')?.status).toBe('pending');
    expect(eng.text).toContain('제출기한을');
    expect(selectPendingCount(useEditor.getState())).toBe(1);
  });

  it('같은 제안을 다시 올려도 중복되지 않는다', () => {
    const p = replace('a', 0, '제출기한을', '제출 기한을');
    useEditor.getState().addProposals([p]);
    expect(useEditor.getState().addProposals([p])).toBe(0);
    expect(useEditor.getState().items).toHaveLength(1);
  });

  it('취소한 제안을 같은 id 로 다시 올리면 새로 대기 상태가 된다', () => {
    const p = replace('a', 0, '제출기한을', '제출 기한을');
    useEditor.getState().addProposals([p]);
    useEditor.getState().dismissItem('a');
    expect(item('a')?.status).toBe('dismissed');
    expect(useEditor.getState().addProposals([p])).toBe(1);
    expect(item('a')?.status).toBe('pending');
  });
});

describe('적용과 되돌리기', () => {
  it('적용하면 문서가 바뀌고, 되돌리면 정확히 원래대로 돌아간다', async () => {
    const before = eng.text;
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을')]);
    await useEditor.getState().applyItem('a');
    expect(item('a')?.status).toBe('applied');
    expect(eng.text).toContain('제출 기한을');
    await useEditor.getState().revertItem('a');
    expect(item('a')?.status).toBe('pending');
    expect(eng.text).toBe(before);
  });

  it('그 사이 문서가 바뀌어 고칠 글이 없으면 stale 로 표시하고 문서는 그대로 둔다', async () => {
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을')]);
    eng.text = '완전히 다른 글';
    await useEditor.getState().applyItem('a');
    expect(item('a')?.status).toBe('stale');
    expect(item('a')?.message).toBeTruthy();
    expect(eng.text).toBe('완전히 다른 글');
  });

  it('사용자가 적용한 곳을 직접 또 고쳤다면 되돌리지 못하고 안내한다', async () => {
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을')]);
    await useEditor.getState().applyItem('a');
    eng.text = eng.text.replace('제출 기한을', '다른 말을');
    await useEditor.getState().revertItem('a');
    expect(item('a')?.status).toBe('applied');
    expect(item('a')?.message).toContain('되돌릴 수 없어요');
  });

  it('여러 변경이 든 제안은 하나라도 실패하면 아무것도 바꾸지 않는다', async () => {
    const before = eng.text;
    const p: Proposal = {
      ...replace('multi', 0, '제출기한을', '제출 기한을'),
      ops: [
        { type: 'replaceText', paragraph: 0, find: '제출기한을', replace: '제출 기한을' },
        { type: 'replaceText', paragraph: 1, find: '없는글', replace: 'x' },
      ],
    };
    useEditor.getState().addProposals([p]);
    await useEditor.getState().applyItem('multi');
    expect(item('multi')?.status).toBe('stale');
    expect(eng.text).toBe(before);
  });

  it('대기 상태가 아닌 제안은 적용하지 않는다', async () => {
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을')]);
    useEditor.getState().dismissItem('a');
    await useEditor.getState().applyItem('a');
    expect(item('a')?.status).toBe('dismissed');
    expect(eng.text).toContain('제출기한을');
  });

  it('전체 적용은 대기 중인 것만 순서대로 적용하고 결과를 알린다', async () => {
    useEditor.getState().addProposals([
      replace('a', 0, '제출기한을', '제출 기한을'),
      replace('b', 1, '보내 주세요', '보내 주십시오'),
      replace('c', 1, '없는글', 'x'),
    ]);
    useEditor.getState().dismissItem('b');
    await useEditor.getState().applyAll();
    expect(item('a')?.status).toBe('applied');
    expect(item('b')?.status).toBe('dismissed');
    expect(item('c')?.status).toBe('stale');
    expect(useToasts.getState().items.at(-1)?.message).toContain('1개를 적용했고, 1개는 적용하지 못했어요');
  });

  it('적용 요청이 겹쳐도 한 번에 하나씩 순서대로 처리한다', async () => {
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을'), replace('b', 1, '보내 주세요', '보내 주십시오')]);
    eng.holdFirst();
    const first = useEditor.getState().applyItem('a');
    const second = useEditor.getState().applyItem('b');
    await Promise.resolve();
    expect(eng.order.filter((x) => x.startsWith('start')).length).toBe(1);
    eng.releaseFirst();
    await Promise.all([first, second]);
    expect(eng.order.map((x) => (x === 'end' ? 'end' : 'start'))).toEqual(['start', 'end', 'start', 'end']);
    expect(eng.text).toBe('제출 기한을 지켜 주세요.\n자료를 보내 주십시오.');
  });
});

describe('문서 위 표시(하이라이트)', () => {
  it('대기 중인 제안만 표시하고, 적용하면 표시가 사라진다', async () => {
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을'), replace('b', 1, '보내 주세요', '보내 주십시오')]);
    expect(eng.highlights.at(-1)?.pending).toEqual([
      { paragraph: 0, find: '제출기한을' },
      { paragraph: 1, find: '보내 주세요' },
    ]);
    await useEditor.getState().applyItem('a');
    expect(eng.highlights.at(-1)?.pending).toEqual([{ paragraph: 1, find: '보내 주세요' }]);
  });

  it('카드에 마우스를 올리면 그 제안만 진하게 표시한다', () => {
    useEditor.getState().addProposals([replace('a', 0, '제출기한을', '제출 기한을'), replace('b', 1, '보내 주세요', '보내 주십시오')]);
    useEditor.getState().setFocus('b');
    expect(eng.highlights.at(-1)?.focus).toEqual([{ paragraph: 1, find: '보내 주세요' }]);
    useEditor.getState().setFocus(null);
    expect(eng.highlights.at(-1)?.focus).toEqual([]);
  });

  it('점검 결과를 눌러 잠깐 표시한 곳은 시간이 지나면 지워진다', () => {
    vi.useFakeTimers();
    try {
      useEditor.getState().flash([{ paragraph: 1 }], 500);
      expect(eng.highlights.at(-1)?.focus).toEqual([{ paragraph: 1 }]);
      vi.advanceTimersByTime(600);
      expect(eng.highlights.at(-1)?.focus).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('computeHighlights 는 서식 변경은 문단 전체를 가리킨다', () => {
    const state = computeHighlights(
      [{ proposal: { id: 'x', category: 'format', title: 't', description: 'd', before: 'a', after: 'b', ops: [{ type: 'setCharStyle', paragraph: 4, style: { fontSizePt: 12 } }] }, status: 'pending', inverse: null, message: null }],
      null,
    );
    expect(state.pending).toEqual([{ paragraph: 4 }]);
  });
});
