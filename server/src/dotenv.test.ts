import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadDotEnv } from './dotenv';

/** 실제 파일 시스템 대신, 주어진 경로들만 있는 것처럼 꾸민 의존성 */
function fake(files: string[], env: Record<string, string | undefined> = {}, cwd = '/repo/server') {
  const loaded: string[] = [];
  return { loaded, deps: { env, cwd, exists: (p: string) => files.includes(p), load: (p: string) => void loaded.push(p) } };
}

describe('loadDotEnv', () => {
  it('지금 폴더의 .env 가 있으면 그것을 읽는다', () => {
    const { deps, loaded } = fake(['/repo/server/.env', '/repo/.env']);
    expect(loadDotEnv(deps)).toBe('/repo/server/.env');
    expect(loaded).toEqual(['/repo/server/.env']); // 위 폴더의 것까지 겹쳐 읽지는 않는다.
  });

  it('없으면 한 단계 위 폴더(저장소 맨 위)의 .env 를 읽는다 — npm 작업공간은 server/ 에서 실행된다', () => {
    const { deps, loaded } = fake(['/repo/.env']);
    expect(loadDotEnv(deps)).toBe('/repo/.env');
    expect(loaded).toEqual(['/repo/.env']);
  });

  it('어디에도 없으면 아무것도 하지 않는다', () => {
    const { deps, loaded } = fake([]);
    expect(loadDotEnv(deps)).toBeNull();
    expect(loaded).toEqual([]);
  });

  it('운영(NODE_ENV=production)에서는 .env 가 있어도 읽지 않는다', () => {
    const { deps, loaded } = fake(['/repo/.env'], { NODE_ENV: 'production' });
    expect(loadDotEnv(deps)).toBeNull();
    expect(loaded).toEqual([]);
  });

  it('읽다가 실패하면 경고만 하고 계속한다(서버가 멈추지 않는다)', () => {
    const warn = vi.fn();
    const deps = {
      env: {},
      cwd: '/repo',
      exists: () => true,
      load: () => {
        throw new Error('권한이 없어요');
      },
    };
    expect(loadDotEnv(deps, warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('권한이 없어요');
  });

  it('실제 파일: 이미 정해 둔 환경 변수는 덮어쓰지 않고, 없던 것만 채운다', () => {
    const root = mkdtempSync(join(tmpdir(), 'alldoc-dotenv-'));
    mkdirSync(join(root, 'server'));
    writeFileSync(join(root, '.env'), 'ALLDOC_DOTENV_A=파일 값\nALLDOC_DOTENV_B=파일 값\nALLDOC_DOTENV_C=\n');
    process.env.ALLDOC_DOTENV_A = '명령에서 준 값';
    try {
      // env 는 실제 process.env 를 쓰고(production 이 아님), 폴더만 임시 폴더로 바꾼다.
      const file = loadDotEnv({ cwd: join(root, 'server') });
      expect(file).toBe(join(root, '.env'));
      expect(process.env.ALLDOC_DOTENV_A).toBe('명령에서 준 값');
      expect(process.env.ALLDOC_DOTENV_B).toBe('파일 값');
      expect(process.env.ALLDOC_DOTENV_C).toBe(''); // 빈 값은 설정 읽기에서 "없음"으로 취급한다(config 의 blank).
    } finally {
      delete process.env.ALLDOC_DOTENV_A;
      delete process.env.ALLDOC_DOTENV_B;
      delete process.env.ALLDOC_DOTENV_C;
    }
  });
});
