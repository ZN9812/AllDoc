import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface DotEnvDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  exists: (path: string) => boolean;
  load: (path: string) => void;
}

const defaultDeps = (): DotEnvDeps => ({
  env: process.env,
  cwd: process.cwd(),
  exists: existsSync,
  load: (path) => process.loadEnvFile(path),
});

/**
 * 개발·시험용 편의: 저장소 맨 위의 `.env` 를 환경 변수로 읽는다(`cp .env.example .env` 해서 고쳐 쓰는 흐름).
 *
 * - 이미 정해 둔 환경 변수는 덮어쓰지 않는다. 그래서 `AUTH_MODE=dev npm start` 처럼 명령에서 준 값이 `.env` 보다 앞선다.
 * - 운영(`NODE_ENV=production`)에서는 읽지 않는다. 운영은 Docker 의 env_file, systemd 의 EnvironmentFile 처럼 실행 환경이 값을 넣는다.
 * - 찾는 곳은 지금 폴더와 그 위 폴더다. npm 작업공간은 `server/` 에서 실행되므로, 저장소 맨 위의 `.env` 는 한 단계 위에 있다.
 *
 * 읽은 파일의 경로를 돌려준다(읽지 않았으면 null). 읽다가 실패하면 경고만 하고 계속한다(환경 변수가 다른 방법으로 들어왔을 수 있다).
 */
export function loadDotEnv(overrides: Partial<DotEnvDeps> = {}, warn: (message: string) => void = console.warn): string | null {
  const deps = { ...defaultDeps(), ...overrides };
  if (deps.env.NODE_ENV === 'production') return null;
  for (const dir of [deps.cwd, resolve(deps.cwd, '..')]) {
    const file = join(dir, '.env');
    if (!deps.exists(file)) continue;
    try {
      deps.load(file);
      return file;
    } catch (e) {
      warn(`.env 를 읽지 못했어요(${file}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }
  return null;
}
