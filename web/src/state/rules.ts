import { create } from 'zustand';

/** 서식 점검의 "내 규칙": 말로 적은 규칙을 이 브라우저에 저장해 두고 다시 쓴다. */
export interface SavedRule {
  id: string;
  name: string;
  text: string;
}

const KEY = 'alldoc.rules';
const MAX_RULES = 10;

function load(): SavedRule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((r): r is SavedRule => !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.text === 'string').slice(0, MAX_RULES);
  } catch {
    return [];
  }
}

function persist(rules: SavedRule[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rules));
  } catch {
    // 저장이 막혀도 이번 화면에서는 계속 쓸 수 있다.
  }
}

interface RulesState {
  rules: SavedRule[];
  save: (text: string) => SavedRule | null;
  remove: (id: string) => void;
}

export const useRules = create<RulesState>((set, get) => ({
  rules: load(),
  save: (text) => {
    const t = text.trim();
    if (!t) return null;
    const name = t.replace(/\s+/g, ' ').slice(0, 24);
    const rule: SavedRule = { id: crypto.randomUUID(), name, text: t };
    const rules = [rule, ...get().rules.filter((r) => r.text !== t)].slice(0, MAX_RULES);
    persist(rules);
    set({ rules });
    return rule;
  },
  remove: (id) => {
    const rules = get().rules.filter((r) => r.id !== id);
    persist(rules);
    set({ rules });
  },
}));
