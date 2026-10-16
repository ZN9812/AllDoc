import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRules } from './rules';

afterEach(() => {
  vi.unstubAllGlobals();
  useRules.setState({ rules: [] });
  localStorage.clear();
});

describe('내 규칙 저장', () => {
  it('crypto.randomUUID 가 없는 주소(사내망 http)에서도 규칙을 저장한다', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });

    const rule = useRules.getState().save('본문은 11pt');

    expect(rule).toMatchObject({ name: '본문은 11pt', text: '본문은 11pt' });
    expect(useRules.getState().rules).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('alldoc.rules') ?? '[]')).toHaveLength(1);
  });
});
