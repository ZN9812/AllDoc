import { create } from 'zustand';

/** 위쪽 바의 "내 문서 검색" 입력값. 홈의 최근 문서와 내 문서 목록을 걸러낸다. */
export const useSearch = create<{ query: string; setQuery: (q: string) => void }>((set) => ({
  query: '',
  setQuery: (query) => set({ query }),
}));
