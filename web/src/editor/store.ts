import { create } from 'zustand';
import { proposalParagraphs, type Criteria, type Op, type Proposal, type StyleProfile } from '@alldoc/shared';
import type { ConsistencyResult } from '../ai/consistency';
import type { EngineHandle, HighlightState, HighlightTarget, PagesApi } from '../engines/types';
import { toast } from '../state/toast';

export type Tab = 'chat' | 'format' | 'changes';
export type ItemStatus = 'pending' | 'applied' | 'dismissed' | 'stale' | 'failed';

export interface ProposalItem {
  proposal: Proposal;
  status: ItemStatus;
  /** 적용했을 때 되돌리기에 쓸 역변경 */
  inverse: Op[] | null;
  /** 실패한 이유 등 카드에 보여줄 안내 */
  message: string | null;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tone?: 'error' | 'demo';
  /** 이 답변에서 변경 내역에 제안이 올라갔는지(링크를 보여준다) */
  hasProposals?: boolean;
}

export interface ReferenceDoc {
  name: string;
  profile: StyleProfile;
}

interface EditorState {
  engine: EngineHandle | null;
  pages: PagesApi | null;
  tab: Tab;
  sheetOpen: boolean;
  items: ProposalItem[];
  focusId: string | null;
  thread: ChatMsg[];
  busy: boolean;
  criteria: Criteria;
  rulesText: string;
  reference: ReferenceDoc | null;
  consistency: ConsistencyResult | null;
  /** 서식 점검 결과를 눌렀을 때 잠깐 진하게 표시할 곳 */
  flashTargets: HighlightTarget[];

  reset: () => void;
  setEngine: (e: EngineHandle | null) => void;
  setPages: (p: PagesApi | null) => void;
  setTab: (t: Tab) => void;
  openSheet: (t?: Tab) => void;
  closeSheet: () => void;
  setBusy: (b: boolean) => void;
  pushMsg: (m: Omit<ChatMsg, 'id'>) => void;
  setCriteria: (c: Criteria) => void;
  setRulesText: (t: string) => void;
  setReference: (r: ReferenceDoc | null) => void;
  setConsistency: (r: ConsistencyResult | null) => void;

  addProposals: (ps: Proposal[]) => number;
  applyItem: (id: string) => Promise<void>;
  applyAll: () => Promise<void>;
  revertItem: (id: string) => Promise<void>;
  dismissItem: (id: string) => void;
  restoreItem: (id: string) => void;
  setFocus: (id: string | null) => void;
  flash: (targets: HighlightTarget[], ms?: number) => void;
}

/**
 * 변경 하나가 성공했을 때 문단 글의 지문이 어떻게 바뀌었는지: 문단 번호 → { 적용 전, 적용 후 }.
 * 적용 전은 먼저 적용된 변경의 guard, 적용 후는 되돌리기용 역변경(되돌릴 순서)에서 가장 먼저 나오는 것의 guard 이다.
 */
function guardTransitions(ops: Op[], inverse: Op[]): Map<number, { pre: string; post: string }> {
  const out = new Map<number, { pre: string; post: string }>();
  for (const op of ops) if (op.guard !== undefined && !out.has(op.paragraph)) out.set(op.paragraph, { pre: op.guard, post: op.guard });
  const done = new Set<number>();
  for (const inv of inverse) {
    const t = out.get(inv.paragraph);
    if (t && inv.guard !== undefined && !done.has(inv.paragraph)) {
      t.post = inv.guard;
      done.add(inv.paragraph);
    }
  }
  return out;
}

const remap = (op: Op, t: Map<number, { pre: string; post: string }>): Op => {
  const e = t.get(op.paragraph);
  return e && op.guard === e.pre && e.pre !== e.post ? { ...op, guard: e.post } : op;
};

/**
 * 우리가 직접 문서를 바꾼 뒤에는, 같은 문단을 가리키는 다른 제안들의 "본 글의 지문"도 새 글에 맞춰 준다.
 * (같은 문단에 제안이 여러 개일 때, 하나를 적용하거나 되돌려도 나머지가 "문서가 바뀌었다"고 거절되지 않도록.)
 * 사용자가 직접 고쳐서 달라진 경우는 지문이 맞지 않으므로 그대로 거절된다.
 */
export function rebaseGuards(items: ProposalItem[], skipId: string, ops: Op[], inverse: Op[]): ProposalItem[] {
  const t = guardTransitions(ops, inverse);
  if (t.size === 0) return items;
  return items.map((it) => {
    if (it.proposal.id === skipId) return it;
    const next: ProposalItem = { ...it };
    if (it.status === 'pending' || it.status === 'stale' || it.status === 'failed' || it.status === 'dismissed') {
      next.proposal = { ...it.proposal, ops: it.proposal.ops.map((op) => remap(op, t)) };
    }
    if (it.status === 'applied' && it.inverse) next.inverse = it.inverse.map((op) => remap(op, t));
    return next;
  });
}

const targetOf = (op: Op): HighlightTarget => (op.type === 'replaceText' ? { paragraph: op.paragraph, find: op.find } : { paragraph: op.paragraph });

export function computeHighlights(items: ProposalItem[], focusId: string | null, flash: HighlightTarget[] = []): HighlightState {
  const pending = items.filter((i) => i.status === 'pending');
  const focused = pending.find((i) => i.proposal.id === focusId);
  return {
    pending: pending.flatMap((i) => i.proposal.ops.map(targetOf)),
    focus: [...(focused ? focused.proposal.ops.map(targetOf) : []), ...flash],
  };
}

// 적용과 되돌리기는 한 번에 하나씩 순서대로 실행한다(편집기가 동시에 여러 변경을 받지 않도록).
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let msgSeq = 0;

const initial = {
  engine: null,
  pages: null,
  tab: 'changes' as Tab,
  sheetOpen: false,
  items: [] as ProposalItem[],
  focusId: null,
  thread: [] as ChatMsg[],
  busy: false,
  criteria: 'consistency' as Criteria,
  rulesText: '',
  reference: null,
  consistency: null,
  flashTargets: [] as HighlightTarget[],
};

export const useEditor = create<EditorState>((set, get) => {
  const sync = () => {
    const { engine, items, focusId, flashTargets } = get();
    engine?.setHighlights(computeHighlights(items, focusId, flashTargets));
  };
  const patch = (id: string, change: Partial<ProposalItem>) => {
    set((s) => ({ items: s.items.map((i) => (i.proposal.id === id ? { ...i, ...change } : i)) }));
  };

  return {
    ...initial,

    reset: () => set({ ...initial }),
    setEngine: (engine) => {
      set({ engine });
      sync();
    },
    setPages: (pages) => set({ pages }),
    setTab: (tab) => set({ tab }),
    openSheet: (tab) => set({ sheetOpen: true, ...(tab ? { tab } : {}) }),
    closeSheet: () => set({ sheetOpen: false }),
    setBusy: (busy) => set({ busy }),
    pushMsg: (m) => set((s) => ({ thread: [...s.thread, { ...m, id: `m${++msgSeq}` }] })),
    setCriteria: (criteria) => set({ criteria }),
    setRulesText: (rulesText) => set({ rulesText }),
    setReference: (reference) => set({ reference }),
    setConsistency: (consistency) => set({ consistency }),

    addProposals: (ps) => {
      let added = 0;
      set((s) => {
        const items = [...s.items];
        for (const proposal of ps) {
          const at = items.findIndex((i) => i.proposal.id === proposal.id);
          const existing = at >= 0 ? items[at] : undefined;
          if (existing?.status === 'applied') continue;
          if (existing?.status === 'pending') {
            // 같은 제안을 다시 올리면 최신 점검 결과(문단 번호·지문)로 갱신하되, 새로 올라간 것으로 세지는 않는다.
            items[at] = { ...existing, proposal };
            continue;
          }
          const fresh: ProposalItem = { proposal, status: 'pending', inverse: null, message: null };
          if (at >= 0) items[at] = fresh;
          else items.push(fresh);
          added++;
        }
        return { items };
      });
      sync();
      return added;
    },

    applyItem: (id) =>
      enqueue(async () => {
        const { engine, items } = get();
        const item = items.find((i) => i.proposal.id === id);
        if (!engine || !item || item.status !== 'pending') return;
        const r = await engine.apply(item.proposal.ops);
        if (r.ok) {
          set((st) => ({ items: rebaseGuards(st.items, id, item.proposal.ops, r.inverse) }));
          patch(id, { status: 'applied', inverse: r.inverse, message: null });
        } else patch(id, { status: r.reason === 'stale' ? 'stale' : 'failed', message: r.message });
        sync();
      }),

    applyAll: async () => {
      const ids = get()
        .items.filter((i) => i.status === 'pending')
        .map((i) => i.proposal.id);
      for (const id of ids) await get().applyItem(id);
      const items = get().items.filter((i) => ids.includes(i.proposal.id));
      const ok = items.filter((i) => i.status === 'applied').length;
      const bad = items.length - ok;
      toast(bad === 0 ? `${ok}개를 적용했어요.` : `${ok}개를 적용했고, ${bad}개는 적용하지 못했어요.`, bad === 0 ? 'info' : 'error');
    },

    revertItem: (id) =>
      enqueue(async () => {
        const { engine, items } = get();
        const item = items.find((i) => i.proposal.id === id);
        if (!engine || !item || item.status !== 'applied' || !item.inverse) return;
        const r = await engine.apply(item.inverse);
        if (r.ok) {
          set((st) => ({ items: rebaseGuards(st.items, id, item.inverse as Op[], r.inverse) }));
          // 되돌린 제안은 다시 적용할 수 있어야 하므로, 되돌린 뒤의 글에 맞춰 지문을 새로 맞춘다.
          const t = guardTransitions(item.inverse, r.inverse);
          const ops = item.proposal.ops.map((op) => {
            const e = t.get(op.paragraph);
            return e && op.guard !== undefined ? { ...op, guard: e.post } : op;
          });
          patch(id, { status: 'pending', inverse: null, message: null, proposal: { ...item.proposal, ops } });
        } else patch(id, { message: '고친 뒤 문서가 바뀌어 되돌릴 수 없어요. 문서에서 직접 고쳐 주세요.' });
        sync();
      }),

    dismissItem: (id) => {
      const item = get().items.find((i) => i.proposal.id === id);
      if (item?.status !== 'pending') return;
      patch(id, { status: 'dismissed', message: null });
      sync();
    },

    restoreItem: (id) => {
      const item = get().items.find((i) => i.proposal.id === id);
      if (!item || item.status === 'pending' || item.status === 'applied') return;
      patch(id, { status: 'pending', message: null });
      sync();
    },

    setFocus: (focusId) => {
      if (get().focusId === focusId) return;
      set({ focusId });
      sync();
    },

    flash: (targets, ms = 1600) => {
      set({ flashTargets: targets });
      sync();
      setTimeout(() => {
        // 그 사이 다른 곳을 눌렀다면 지우지 않는다.
        if (get().flashTargets === targets) {
          set({ flashTargets: [] });
          sync();
        }
      }, ms);
    },
  };
});

export const selectPendingCount = (s: Pick<EditorState, 'items'>): number => s.items.filter((i) => i.status === 'pending').length;

export { proposalParagraphs };
