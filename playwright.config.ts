import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;
/** 약관 동의(TERMS_VERSION)를 켠 두 번째 서버. e2e/terms.spec.ts 만 여기에 붙는다. */
const TERMS_PORT = 8798;
const common = {
  AUTH_MODE: 'dev',
  AI_PROVIDER: 'mock',
  SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-0123456789',
  DAILY_AI_LIMIT: '3',
  // LaTeX 는 데모 컴파일러로 시험한다(실제 TeX 는 e2e/tex-real.spec.ts, REQUIRE_TEXLIVE=1).
  COMPILER: 'mock',
};

/**
 * 진짜 컴파일 일꾼으로 도는 LaTeX 시험(e2e/tex-real.spec.ts). REQUIRE_TEXLIVE=1 일 때만 세 번째 서버를 띄운다.
 * 일꾼은 따로 띄워 둔다(COMPILER_URLS, 기본 http://localhost:8790. 비밀값은 COMPILER_SECRET 으로 둘이 같아야 한다).
 */
const TEX_REAL = process.env.REQUIRE_TEXLIVE === '1';
const TEX_REAL_PORT = 8797;

// 이미 설치된 크로미움을 직접 쓸 때만 PW_CHROMIUM_PATH 를 지정한다. (보통은 npx playwright install chromium)
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    acceptDownloads: true,
    locale: 'ko-KR',
    launchOptions: {
      executablePath,
      // 리눅스 크로미움은 UTF-8 로캘이 없으면 한글 이름으로 내려받은 파일을 "download" 로 바꾼다.
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } as Record<string, string>,
    },
  },
  projects: [
    { name: 'desktop', testIgnore: [/\.phone\.spec\.ts$/, /terms\.spec\.ts$/, /tex-real\.spec\.ts$/], use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', testMatch: /\.phone\.spec\.ts$/, use: { ...devices['Pixel 7'] } },
    {
      name: 'terms',
      testMatch: /terms\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${TERMS_PORT}` },
    },
    {
      name: 'tex-real',
      testMatch: /tex-real\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, baseURL: `http://localhost:${TEX_REAL_PORT}` },
    },
  ],
  // 빌드된 서버(npm run build 필요)를 데모 AI·개발용 로그인으로 띄워서 시험한다.
  webServer: [
    {
      command: 'node --disable-warning=ExperimentalWarning server/dist/main.js',
      url: `http://localhost:${PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { ...common, PORT: String(PORT), PUBLIC_URL: `http://localhost:${PORT}`, DATA_DIR: 'e2e/.data' },
    },
    {
      command: 'node --disable-warning=ExperimentalWarning server/dist/main.js',
      url: `http://localhost:${TERMS_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        ...common,
        PORT: String(TERMS_PORT),
        PUBLIC_URL: `http://localhost:${TERMS_PORT}`,
        DATA_DIR: 'e2e/.data-terms',
        TERMS_VERSION: 'e2e-1',
        TERMS_URL: 'https://example.com/terms',
        PRIVACY_URL: 'https://example.com/privacy',
      },
    },
    ...(TEX_REAL
      ? [
          {
            command: 'node --disable-warning=ExperimentalWarning server/dist/main.js',
            url: `http://localhost:${TEX_REAL_PORT}/api/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            env: {
              ...common,
              PORT: String(TEX_REAL_PORT),
              PUBLIC_URL: `http://localhost:${TEX_REAL_PORT}`,
              DATA_DIR: 'e2e/.data-tex',
              COMPILER: 'http',
              COMPILER_URLS: process.env.COMPILER_URLS || 'http://localhost:8790',
              COMPILER_SECRET: process.env.COMPILER_SECRET || 'e2e-compiler-secret-e2e-compiler-secret-0123',
            },
          },
        ]
      : []),
  ],
});
