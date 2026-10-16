// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { unzipSync, zipSync } from 'fflate';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTexDoc, DB_VERSION, getDoc, listDocs, listTexFiles, removeDoc, replaceTexFiles, resetDbConnection, updateTexFiles } from './docs';
import { exportZip, importSingleTex, importZip, pickEngine, pickMain, readCentralDirectory, sha256Hex, skippedNotice, TexImportError, toRecords } from './texProject';

const enc = new TextEncoder();
const MAIN = '\\documentclass{article}\n\\usepackage{kotex}\n\\begin{document}\n안녕\n\\end{document}\n';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbConnection();
});

afterEach(() => vi.unstubAllGlobals());

describe('ZIP 가져오기', () => {
  it('파일을 풀고 주 파일·엔진을 고르며, 폴더 하나로 감싼 ZIP 은 그 폴더를 벗긴다', () => {
    const zip = zipSync({ '논문/main.tex': enc.encode(MAIN), '논문/장/1.tex': enc.encode('\\section{가}'), '논문/그림/a.png': new Uint8Array([137, 80, 78, 71]) });
    const r = importZip(zip);
    expect(r.files.map((f) => f.path).sort()).toEqual(['main.tex', '그림/a.png', '장/1.tex']);
    expect(r.project).toEqual({ main: 'main.tex', engine: 'xelatex' });
    expect(r.skipped).toEqual([]);
  });

  it('".."·절대 경로·latexmkrc·심볼릭 링크·암호화 항목은 빼고 알린다', () => {
    const zip = zipSync({
      'main.tex': enc.encode(MAIN),
      '../evil.tex': enc.encode('x'),
      '/etc/passwd': enc.encode('x'),
      latexmkrc: enc.encode('$pdflatex = "rm -rf /";'),
      'sub/.latexmkrc': enc.encode('x'),
      // 유닉스(os 3)의 심볼릭 링크(파일 종류 0o120000)
      'link.tex': [enc.encode('/etc/passwd'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
    });
    const r = importZip(zip);
    expect(r.files.map((f) => f.path)).toEqual(['main.tex']);
    expect(r.skipped.map((s) => s.reason).sort()).toEqual(['latexmkrc', 'latexmkrc', 'symlink', 'unsafe-path', 'unsafe-path']);
    expect(skippedNotice(r.skipped)).toContain('5개 항목을 빼고 열었어요');
  });

  it('암호가 걸린 항목(일반 목적 표시 1번 비트)은 뺀다', () => {
    const zip = zipSync({ 'main.tex': enc.encode(MAIN), 'secret.tex': enc.encode('x') });
    // 두 번째 항목의 지역 머리와 중앙 목록의 표시를 고친다.
    const v = new DataView(zip.buffer);
    for (let i = 0; i < zip.length - 4; i++) {
      const sig = v.getUint32(i, true);
      if (sig === 0x02014b50 && new TextDecoder().decode(zip.subarray(i + 46, i + 46 + v.getUint16(i + 28, true))) === 'secret.tex') v.setUint16(i + 8, v.getUint16(i + 8, true) | 1, true);
    }
    expect(readCentralDirectory(zip).find((e) => e.name === 'secret.tex')?.encrypted).toBe(true);
    const r = importZip(zip);
    expect(r.skipped).toEqual([{ path: 'secret.tex', reason: 'encrypted' }]);
  });

  it('압축률이 100배를 넘는 큰 항목(zip 폭탄)과 너무 큰 전체 크기, 너무 많은 파일은 열지 않는다', () => {
    const bomb = zipSync({ 'main.tex': enc.encode(MAIN), 'zeros.dat': new Uint8Array(4 * 1024 * 1024) });
    expect(() => importZip(bomb)).toThrow(/압축 폭탄/);
    const big = zipSync({ 'main.tex': enc.encode(MAIN), 'b.dat': [crypto.getRandomValues(new Uint8Array(60_000)), { level: 0 }] });
    expect(() => importZip(big, { maxBytes: 50_000 })).toThrow(/너무 커요/);
    const many = zipSync(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.tex`, enc.encode(MAIN)])));
    expect(() => importZip(many, { maxFiles: 5 })).toThrow(/너무 많아요/);
  });

  it('.tex 가 없는 ZIP 과 ZIP 이 아닌 파일은 알아듣기 쉬운 오류', () => {
    expect(() => importZip(zipSync({ 'a.png': new Uint8Array([1]) }))).toThrow(/\.tex 파일이 없어요/);
    expect(() => importZip(enc.encode('not a zip'))).toThrow(TexImportError);
  });

  it('주 파일은 \\documentclass 가 있는 것 중 main.tex → 얕은 경로 순, 주석 속 \\documentclass 는 치지 않는다', () => {
    expect(pickMain([{ path: 'a/main.tex', text: MAIN }, { path: 'thesis.tex', text: MAIN }])).toBe('a/main.tex');
    expect(pickMain([{ path: 'b/x.tex', text: MAIN }, { path: 'paper.tex', text: MAIN }])).toBe('paper.tex');
    expect(pickMain([{ path: 'a.tex', text: '% \\documentclass{x}' }, { path: 'b.tex', text: MAIN }])).toBe('b.tex');
    expect(pickMain([{ path: 'img.png' }])).toBeNull();
  });

  it('엔진은 "% !TEX program" 표시를 먼저 따르고, luatexko 면 LuaLaTeX, 그 밖에는 XeLaTeX', () => {
    expect(pickEngine('% !TEX program = pdflatex\n\\documentclass{article}')).toBe('pdflatex');
    expect(pickEngine('% !TeX TS-program = lualatex\n')).toBe('lualatex');
    expect(pickEngine('\\usepackage{luatexko}')).toBe('lualatex');
    expect(pickEngine('% !TEX program = tectonic\n')).toBe('xelatex');
    expect(pickEngine(MAIN)).toBe('xelatex');
  });

  it('.tex 하나는 파일 하나짜리 프로젝트가 된다', () => {
    expect(importSingleTex('보고서.tex', enc.encode(MAIN))).toMatchObject({ files: [{ path: '보고서.tex' }], project: { main: '보고서.tex', engine: 'xelatex' } });
  });

  it('내보낸 ZIP 을 다시 풀면 같은 파일이 나온다(한글 이름 포함)', async () => {
    const zip = await exportZip([
      { path: 'main.tex', blob: new Blob([MAIN]) },
      { path: '그림/사진.png', blob: new Blob([new Uint8Array([1, 2, 3])]) },
    ]);
    const back = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(back).sort()).toEqual(['main.tex', '그림/사진.png']);
    expect(new TextDecoder().decode(back['main.tex'])).toBe(MAIN);
  });

  it('sha256 은 16진 64자', async () => {
    expect(await sha256Hex(enc.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('LaTeX 프로젝트 저장(IndexedDB)', () => {
  it(`DB 를 버전 1 에서 ${DB_VERSION} 로 올려도 기존 문서가 남고 texFiles 저장소가 생긴다`, async () => {
    const v1 = await openDB('alldoc', 1, {
      upgrade(d) {
        const docs = d.createObjectStore('docs', { keyPath: 'id' });
        docs.createIndex('by-opened', 'openedAt');
        d.createObjectStore('files', { keyPath: 'key' });
      },
    });
    await v1.put('docs', { id: 'old', name: '옛 문서.txt', kind: 'txt', size: 2, createdAt: 1, updatedAt: 1, openedAt: 1, edited: false });
    await v1.put('files', { key: 'old/original', blob: new Blob(['옛']) });
    await v1.put('files', { key: 'old/working', blob: new Blob(['옛']) });
    v1.close();

    expect((await listDocs()).map((d) => d.id)).toEqual(['old']);
    expect(await (await getDoc('old'))!.working.text()).toBe('옛');
    const raw = await openDB('alldoc', DB_VERSION);
    expect([...raw.objectStoreNames].sort()).toEqual(['docs', 'files', 'texFiles']);
    raw.close();
  });

  it('프로젝트를 만들고, 바뀐 파일만 쓰고, 지우면 파일까지 사라진다', async () => {
    const original = new Blob(['zip']);
    const files = await toRecords([
      { path: 'main.tex', bytes: enc.encode(MAIN) },
      { path: 'a.bib', bytes: enc.encode('@book{x,}') },
    ]);
    const meta = await createTexDoc({ name: '논문.zip', original, files, project: { main: 'main.tex', engine: 'xelatex' } }, 1000);
    expect(meta).toMatchObject({ kind: 'tex', edited: false, project: { main: 'main.tex' } });
    // tex 는 작업본 블롭이 없어 원본으로 대신한다.
    expect(await (await getDoc(meta.id))!.working.text()).toBe('zip');
    expect((await listTexFiles(meta.id)).map((f) => f.path)).toEqual(['a.bib', 'main.tex']);

    const before = (await listTexFiles(meta.id)).find((f) => f.path === 'a.bib')!;
    const [changed] = await toRecords([{ path: 'main.tex', bytes: enc.encode(`${MAIN}%`) }]);
    const next = await updateTexFiles(meta.id, { upsert: [changed!], project: { engine: 'lualatex' } }, 2000);
    expect(next).toMatchObject({ edited: true, updatedAt: 2000, project: { main: 'main.tex', engine: 'lualatex' } });
    const after = await listTexFiles(meta.id);
    expect(after.find((f) => f.path === 'a.bib')).toEqual(before);
    expect(after.find((f) => f.path === 'main.tex')).toMatchObject({ hash: changed!.hash, updatedAt: 2000 });

    await updateTexFiles(meta.id, { remove: ['a.bib'] }, 3000);
    expect((await listTexFiles(meta.id)).map((f) => f.path)).toEqual(['main.tex']);

    const reset = await replaceTexFiles(meta.id, files, { main: 'main.tex', engine: 'xelatex' }, 4000);
    expect(reset.edited).toBe(false);
    expect((await listTexFiles(meta.id)).map((f) => f.path)).toEqual(['a.bib', 'main.tex']);

    await removeDoc(meta.id);
    expect(await getDoc(meta.id)).toBeNull();
    expect(await listTexFiles(meta.id)).toEqual([]);
  });

  it('crypto.subtle·randomUUID 가 없는 주소(사내망 http)에서도 같은 해시로 프로젝트를 만든다', async () => {
    const real = globalThis.crypto;
    const [secure] = await toRecords([{ path: 'main.tex', bytes: enc.encode(MAIN) }]);
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });

    const files = await toRecords([{ path: 'main.tex', bytes: enc.encode(MAIN) }]);
    const meta = await createTexDoc({ name: '사내.tex', original: new Blob([MAIN]), files, project: { main: 'main.tex', engine: 'xelatex' } });

    // 서버는 받은 파일의 SHA-256 을 다시 계산해 대조하므로(server/src/tex/routes.ts) 안전한 주소에서와 같은 값이어야 한다.
    expect(files[0]!.hash).toBe(secure!.hash);
    expect((await listTexFiles(meta.id)).map((f) => f.path)).toEqual(['main.tex']);
  });

  it('다른 문서의 파일은 섞이지 않는다', async () => {
    const files = await toRecords([{ path: 'main.tex', bytes: enc.encode(MAIN) }]);
    const a = await createTexDoc({ name: 'a.tex', original: new Blob(['a']), files, project: { main: 'main.tex', engine: 'xelatex' } });
    const b = await createTexDoc({ name: 'b.tex', original: new Blob(['b']), files, project: { main: 'main.tex', engine: 'xelatex' } });
    await removeDoc(a.id);
    expect((await listTexFiles(b.id)).map((f) => f.path)).toEqual(['main.tex']);
  });
});
