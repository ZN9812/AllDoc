import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;

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
    { name: 'desktop', testIgnore: /\.phone\.spec\.ts$/, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', testMatch: /\.phone\.spec\.ts$/, use: { ...devices['Pixel 7'] } },
  ],
  // 빌드된 서버(npm run build 필요)를 데모 AI·개발용 로그인으로 띄워서 시험한다.
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server/dist/main.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      PUBLIC_URL: `http://localhost:${PORT}`,
      AUTH_MODE: 'dev',
      AI_PROVIDER: 'mock',
      SESSION_SECRET: 'e2e-session-secret-e2e-session-secret-0123456789',
      DAILY_AI_LIMIT: '3',
      DATA_DIR: 'e2e/.data',
    },
  },
});
