import { create } from 'zustand';
import type { SiteInfo } from '@alldoc/shared';
import { fetchSite } from '../ai/client';

/** 서버의 운영 정보(GET /api/site). 서버에 연결할 수 없으면 null 로 두고 하단·베타 안내를 보이지 않는다. */
interface SiteState {
  site: SiteInfo | null;
  load: () => Promise<void>;
}

export const useSite = create<SiteState>((set) => ({
  site: null,
  load: async () => {
    try {
      set({ site: await fetchSite() });
    } catch {
      set({ site: null });
    }
  },
}));

/** 비공개 베타의 로그인 창(초대 코드 입력). next 는 로그인 뒤 돌아올 주소 */
interface InviteLoginState {
  next: string | null;
  open: (next: string) => void;
  close: () => void;
}

export const useInviteLogin = create<InviteLoginState>((set) => ({
  next: null,
  open: (next) => set({ next }),
  close: () => set({ next: null }),
}));
