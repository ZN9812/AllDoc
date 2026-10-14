import { createHash, createHmac } from 'node:crypto';
import { decodeFrame, encodeFrame } from '@alldoc/shared';
import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../test-support/helpers';
import { CompilerFailedError, HttpCompilerClient, MockCompilerClient } from './client';
import { signBody } from './sign';

const enc = new TextEncoder();
const job = (files: Record<string, string>, main = 'main.tex') => ({
  jobId: 'j1',
  engine: 'xelatex' as const,
  main,
  timeoutSec: 60,
  files: Object.entries(files).map(([path, t]) => ({ path, bytes: enc.encode(t) })),
});

describe('데모 컴파일러', () => {
  it('\\newpage 수만큼 쪽이 있는 PDF를 만든다', async () => {
    const r = await new MockCompilerClient().compile(job({ 'main.tex': 'a\\newpage b\\newpage c' }), new AbortController().signal);
    expect(r.status).toBe('ok');
    expect(Buffer.from(r.pdf!).toString('latin1')).toContain('/Count 3');
  });

  it('주 파일이 없으면 오류, 맞지 않는 \\ref 는 경고', async () => {
    expect((await new MockCompilerClient().compile(job({ 'a.tex': '' }), new AbortController().signal)).status).toBe('error');
    const r = await new MockCompilerClient().compile(job({ 'main.tex': '\\label{a}\\ref{a}\n\\ref{b}' }), new AbortController().signal);
    expect(r.status).toBe('ok');
    expect(r.log).toContain("Reference `b' on page 1 undefined on input line 2.");
    expect(r.log).not.toContain("`a'");
  });
});

describe('일꾼 연결(HTTP)', () => {
  it('서명한 작업 묶음을 보내고, 묶음 응답에서 PDF를 꺼낸다', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://w1:8790/compile');
      const body = new Uint8Array(init?.body as Uint8Array);
      const sig = new Headers(init?.headers).get('x-alldoc-signature') as string;
      const [t, v1] = sig.split(',').map((p) => p.split('=')[1]) as [string, string];
      const digest = createHash('sha256').update(body).digest('hex');
      expect(v1).toBe(createHmac('sha256', 's'.repeat(32)).update(`${t}.${digest}`).digest('hex'));
      const f = decodeFrame<{ jobId: string; main: string; files: string[] }>(body);
      expect(f.header).toMatchObject({ jobId: 'j1', main: 'main.tex', files: ['main.tex', 'img/a.png'] });
      return new Response(encodeFrame({ status: 'ok', log: 'log', wallMs: 1200, texlive: '2025', hasPdf: true }, [enc.encode('%PDF-1.5')]));
    });
    const c = new HttpCompilerClient(['http://w1:8790/'], 's'.repeat(32), fetchImpl as unknown as typeof fetch);
    const r = await c.compile(job({ 'main.tex': 'x', 'img/a.png': 'y' }), new AbortController().signal);
    expect(r).toMatchObject({ status: 'ok', wallMs: 1200, texlive: '2025' });
    expect(new TextDecoder().decode(r.pdf!)).toBe('%PDF-1.5');
  });

  it('일꾼이 여럿이면 차례로 쓰고, 연결 실패·오류 응답·깨진 응답은 CompilerFailedError', async () => {
    const urls: string[] = [];
    const ok = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(encodeFrame({ status: 'error', log: '', wallMs: 1, texlive: '', hasPdf: false }, []));
    });
    const c = new HttpCompilerClient(['http://a', 'http://b'], 'k', ok as unknown as typeof fetch);
    await c.compile(job({ 'main.tex': '' }), new AbortController().signal);
    await c.compile(job({ 'main.tex': '' }), new AbortController().signal);
    expect(urls).toEqual(['http://a/compile', 'http://b/compile']);
    for (const f of [
      async () => {
        throw new TypeError('fetch failed');
      },
      async () => new Response('no', { status: 401 }),
      async () => new Response('garbage'),
    ]) {
      await expect(new HttpCompilerClient(['http://a'], 'k', f as unknown as typeof fetch).compile(job({ 'main.tex': '' }), new AbortController().signal)).rejects.toThrow(CompilerFailedError);
    }
  });

  it('서명 형식(compiler/src/run.test.ts 와 같은 고정 값)', () => {
    expect(signBody('secret', enc.encode('body'), 1700000000000)).toBe('t=1700000000000,v1=c20e3d33ddbdef202a94637622680ff44d60ce9c9246bffcffd1611aad58e0ec');
  });
});

describe('컴파일 설정', () => {
  it('기본은 꺼짐, mock 은 기본값을 쓰고, http 는 주소와 32자 이상 비밀값이 있어야 한다', () => {
    expect(testConfig().compiler).toBeNull();
    expect(testConfig({ COMPILER: 'mock' }).compiler).toMatchObject({ mode: 'mock', concurrency: 2, queue: 10, retentionDays: 7 });
    expect(() => testConfig({ COMPILER: 'http' })).toThrow(/COMPILER_URLS[\s\S]*COMPILER_SECRET/);
    expect(() => testConfig({ COMPILER: 'http', COMPILER_URLS: 'not a url', COMPILER_SECRET: 'x'.repeat(32) })).toThrow('올바른 주소');
    expect(testConfig({ COMPILER: 'http', COMPILER_URLS: 'http://compiler:8790, http://c2:8790', COMPILER_SECRET: 'x'.repeat(32) }).compiler?.urls).toEqual(['http://compiler:8790', 'http://c2:8790']);
  });
});
