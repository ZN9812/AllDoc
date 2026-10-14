import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bwrapArgs, JobRejected, validateJob } from './run';
import { signBody, verifyBody } from './sign';

const enc = new TextEncoder();
const base = () => ({ jobId: randomUUID(), engine: 'xelatex', main: 'main.tex', timeoutSec: 60, files: ['main.tex'] });
const one = [enc.encode('x')];

describe('작업 검사', () => {
  it('정상 작업을 받는다', () => {
    expect(validateJob(base(), one, 600)).toMatchObject({ engine: 'xelatex', main: 'main.tex', files: [{ path: 'main.tex' }] });
  });

  it.each([
    ['작업 번호', { jobId: '../../etc' }],
    ['엔진', { engine: 'tectonic' }],
    ['시간 제한(상한 초과)', { timeoutSec: 601 }],
    ['시간 제한(0)', { timeoutSec: 0 }],
    ['밖을 가리키는 경로', { files: ['../main.tex'] }],
    ['latexmkrc', { files: ['latexmkrc'] }],
    ['주 파일이 목록에 없음', { main: 'other.tex' }],
    ['주 파일이 .tex 가 아님', { main: 'main.bib', files: ['main.bib'] }],
  ])('%s 가 이상하면 거절한다', (_, over) => {
    expect(() => validateJob({ ...base(), ...over }, one, 600)).toThrow(JobRejected);
  });

  it('파일 목록과 덩어리 수가 다르거나, 대소문자만 다른 중복은 거절한다', () => {
    expect(() => validateJob(base(), [], 600)).toThrow(JobRejected);
    expect(() => validateJob({ ...base(), files: ['main.tex', 'Main.tex'] }, [...one, ...one], 600)).toThrow(JobRejected);
  });
});

describe('bubblewrap 인자', () => {
  it('이름공간을 모두 나누고 환경을 비운 뒤, 작업 폴더만 쓰기로 붙이고 TeX 설정을 환경 변수로 준다', () => {
    const args = bwrapArgs('/work/j1', { roBinds: ['/usr', '/nonexistent-path-for-test'] }, { shell_escape: 'f', openin_any: 'p' });
    expect(args.slice(0, 4)).toEqual(['--unshare-all', '--die-with-parent', '--new-session', '--clearenv']);
    expect(args.join(' ')).toContain('--ro-bind /usr /usr');
    expect(args).not.toContain('/nonexistent-path-for-test');
    expect(args.join(' ')).toContain('--bind /work/j1 /w');
    expect(args.join(' ')).toContain('--setenv shell_escape f');
    // /proc 는 붙이지 않는다(컨테이너 안에서 systempaths=unconfined 가 필요해서, docs/LATEX.md E3)
    expect(args).not.toContain('--proc');
    expect(args.filter((a) => a === '--bind')).toHaveLength(1);
  });
});

describe('요청 서명', () => {
  const secret = 's'.repeat(32);
  it('맞는 서명만 받고, 본문이 바뀌거나 시각이 5분 넘게 다르면 거절한다', () => {
    const body = enc.encode('job');
    const now = 1_700_000_000_000;
    const sig = signBody(secret, body, now);
    expect(verifyBody(secret, body, sig, now + 1000)).toBe(true);
    expect(verifyBody(secret, enc.encode('jobX'), sig, now)).toBe(false);
    expect(verifyBody('t'.repeat(32), body, sig, now)).toBe(false);
    expect(verifyBody(secret, body, sig, now + 5 * 60_000 + 1)).toBe(false);
    expect(verifyBody(secret, body, undefined, now)).toBe(false);
    expect(verifyBody(secret, body, 'garbage', now)).toBe(false);
  });

  it('본 서버(server/src/tex/sign.ts)와 같은 값을 만든다', () => {
    // server/src/tex/client.test.ts 의 고정 값과 같은 입력
    expect(signBody('secret', enc.encode('body'), 1700000000000)).toBe('t=1700000000000,v1=c20e3d33ddbdef202a94637622680ff44d60ce9c9246bffcffd1611aad58e0ec');
  });
});
