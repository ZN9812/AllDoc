// 출시 준비 설정(비공개 베타·하단 사업자 정보·문의 창구·정책 문서)을 켠 시험 서버(포트 8796)의 환경 변수.
// playwright.config.ts 가 이 값으로 서버를 띄우고, e2e/launch.spec.ts 가 같은 값으로 관리자 도구(server/dist/admin.js)를 돌린다.
// 사업자 정보는 시험용 가짜 값이다.
export const LAUNCH_PORT = 8796;

export const LAUNCH_ENV: Record<string, string> = {
  AUTH_MODE: 'dev',
  AI_PROVIDER: 'mock',
  SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-0123456789',
  DAILY_AI_LIMIT: '3',
  PORT: String(LAUNCH_PORT),
  PUBLIC_URL: `http://localhost:${LAUNCH_PORT}`,
  DATA_DIR: 'e2e/.data-launch',
  BETA_MODE: 'invite',
  BUSINESS_NAME: '시험상호',
  BUSINESS_OWNER: '시험대표',
  BUSINESS_REG_NO: '000-00-00000',
  CONTACT_EMAIL: 'help@example.com',
  POLICY_DIR: 'e2e/policies',
};
