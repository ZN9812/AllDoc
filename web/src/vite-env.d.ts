/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" 이면 Word(DOCX) 지원을 빼고 빌드한다(src/lib/features.ts). */
  readonly VITE_DISABLE_DOCX?: string;
}
