import { create } from 'zustand';
import { useSettings } from './settings';

interface ConsentState {
  resolver: ((ok: boolean) => void) | null;
  ask: () => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useConsent = create<ConsentState>((set, get) => ({
  resolver: null,
  ask: () => new Promise<boolean>((resolve) => set({ resolver: resolve })),
  answer: (ok) => {
    get().resolver?.(ok);
    set({ resolver: null });
  },
}));

/** AI 를 처음 쓸 때 "문서 내용이 AI 서비스로 전송됩니다" 동의를 받는다. 이미 동의했으면 바로 true. */
export async function ensureConsent(): Promise<boolean> {
  const settings = useSettings.getState();
  if (settings.aiConsentAt) return true;
  const ok = await useConsent.getState().ask();
  if (ok) settings.giveConsent();
  return ok;
}
