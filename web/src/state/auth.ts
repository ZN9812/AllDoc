import { create } from 'zustand';
import type { MeResponse, Quota } from '@alldoc/shared';
import { fetchMe, postLogout } from '../ai/client';

interface AuthState {
  me: MeResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setQuota: (q: Quota | null) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
  me: null,
  status: 'idle',
  refresh: async () => {
    set({ status: 'loading' });
    try {
      set({ me: await fetchMe(), status: 'ready' });
    } catch {
      // 서버가 없거나 꺼져 있어도 편집은 동작한다. AI 만 못 쓴다.
      set({ me: null, status: 'error' });
    }
  },
  logout: async () => {
    await postLogout();
    await get().refresh();
  },
  setQuota: (quota) => {
    const me = get().me;
    if (me) set({ me: { ...me, quota } });
  },
}));

/** AI 를 쓸 수 있는 상태인지와, 못 쓰는 이유(화면에 보여줄 문장) */
export function aiAvailability(me: MeResponse | null, aiEnabled: boolean): { ok: true } | { ok: false; reason: 'server' | 'login' | 'off' | 'config'; message: string } {
  if (!aiEnabled) return { ok: false, reason: 'off', message: '설정에서 AI 기능이 꺼져 있어요.' };
  if (!me) return { ok: false, reason: 'server', message: '서버에 연결할 수 없어 AI를 쓸 수 없어요. 편집은 그대로 쓸 수 있어요.' };
  if (!me.ai.available) return { ok: false, reason: 'config', message: '이 서버에는 AI가 연결되어 있지 않아요.' };
  if (me.authMode !== 'none' && !me.authenticated) return { ok: false, reason: 'login', message: 'AI 기능은 로그인 후에 쓸 수 있어요.' };
  return { ok: true };
}
