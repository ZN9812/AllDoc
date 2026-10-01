import { ACCEPT_ATTR } from '@alldoc/shared';

/**
 * 빌드할 때 정하는 기능 스위치. VITE_DISABLE_DOCX=1 로 빌드하면 Word(DOCX) 지원이 빠진다.
 * 이때 SuperDoc 과 그 독점 DOCX 엔진은 빌드 결과물에 들어가지 않는다.
 * SuperDoc 의 DOCX 엔진은 독점 라이선스라, 라이선스를 확인하기 전까지 끄고 배포할 수 있게 한 것이다.
 * (THIRD_PARTY_NOTICES.md, docs/DEPLOY.md 참고. 편집기를 고르는 곳 engines/registry.ts 는 같은 조건을 직접 쓴다 —
 * 빌드 도구가 안 쓰는 갈래를 결과물에서 빼려면 조건이 그 파일 안에 있어야 한다.)
 */
export const DOCX_ENABLED = import.meta.env.VITE_DISABLE_DOCX !== '1';

/** 화면에 보여 줄 지원 형식 목록 */
export const SUPPORTED_FORMATS_TEXT = DOCX_ENABLED ? 'HWP · HWPX · DOCX · PDF · TXT · MD' : 'HWP · HWPX · PDF · TXT · MD';

/** 파일 선택 창에서 보여 줄 확장자 */
export const ACCEPT = DOCX_ENABLED ? ACCEPT_ATTR : ACCEPT_ATTR.replace('.docx,', '');
