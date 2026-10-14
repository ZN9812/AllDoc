import { create } from 'zustand';

/** 약관 동의 창. 로그인한 사용자가 아직 동의하지 않았으면 한 번 저절로 열리고, "나중에"를 누르면 이 탭에서는 다시 저절로 열지 않는다. */
interface TermsState {
  open: boolean;
  dismissed: boolean;
  show: () => void;
  hide: (dismiss?: boolean) => void;
}

export const useTerms = create<TermsState>((set) => ({
  open: false,
  dismissed: false,
  show: () => set({ open: true }),
  hide: (dismiss = false) => set((s) => ({ open: false, dismissed: s.dismissed || dismiss })),
}));
