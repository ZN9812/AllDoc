import { create } from 'zustand';

export type ThemePref = 'light' | 'dark' | 'system';

/** index.html 의 첫 화면 스크립트도 이 값을 읽는다(깜박임 방지). */
const THEME_KEY = 'alldoc.theme';
const SETTINGS_KEY = 'alldoc.settings';

function readLS(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 브라우저가 저장을 막아도 앱은 그대로 동작한다.
  }
}

interface Persisted {
  /** 설정에서 AI 기능을 켜 두었는지 */
  aiEnabled: boolean;
  /** "문서 내용이 AI 서비스로 전송됩니다" 안내에 동의한 시각 */
  aiConsentAt: number | null;
}

function readPersisted(): Persisted {
  const fallback: Persisted = { aiEnabled: true, aiConsentAt: null };
  const raw = readLS(SETTINGS_KEY);
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as Partial<Persisted>;
    return {
      aiEnabled: typeof v.aiEnabled === 'boolean' ? v.aiEnabled : true,
      aiConsentAt: typeof v.aiConsentAt === 'number' ? v.aiConsentAt : null,
    };
  } catch {
    return fallback;
  }
}

function readTheme(): ThemePref {
  const v = readLS(THEME_KEY);
  return v === 'dark' || v === 'system' || v === 'light' ? v : 'light';
}

interface SettingsState extends Persisted {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  setAiEnabled: (on: boolean) => void;
  giveConsent: () => void;
  revokeConsent: () => void;
}

export const useSettings = create<SettingsState>((set, get) => {
  const save = () => {
    const { aiEnabled, aiConsentAt } = get();
    writeLS(SETTINGS_KEY, JSON.stringify({ aiEnabled, aiConsentAt }));
  };
  return {
    ...readPersisted(),
    theme: readTheme(),
    setTheme: (theme) => {
      writeLS(THEME_KEY, theme);
      set({ theme });
    },
    setAiEnabled: (aiEnabled) => {
      set({ aiEnabled });
      save();
    },
    giveConsent: () => {
      set({ aiConsentAt: Date.now() });
      save();
    },
    revokeConsent: () => {
      set({ aiConsentAt: null });
      save();
    },
  };
});
