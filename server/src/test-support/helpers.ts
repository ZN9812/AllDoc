import { loadConfig, type Config } from '../config';

/** 시험용 설정. 환경 변수를 직접 주어 만들고, 파일은 읽지 않는다. */
export function testConfig(env: Record<string, string> = {}, files: Record<string, string> = {}): Config {
  return loadConfig({
    env: {
      AUTH_MODE: 'dev',
      AI_PROVIDER: 'mock',
      SESSION_SECRET: 's'.repeat(40),
      DAILY_AI_LIMIT: '3',
      ...env,
    },
    readFile: (p) => {
      const hit = Object.entries(files).find(([k]) => p.endsWith(k));
      if (!hit) throw new Error(`ENOENT: ${p}`);
      return hit[1];
    },
    moduleDir: '/srv/app/server/dist',
    randomSecret: () => 'r'.repeat(64),
  });
}
