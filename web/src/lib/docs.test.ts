// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDoc, filterDocs, getDoc, listDocs, removeDoc, resetDbConnection, restoreOriginal, saveWorking, touchOpened } from './docs';

const blob = (s: string) => new Blob([s], { type: 'text/plain' });

beforeEach(() => {
  // 시험마다 새 저장소에서 시작한다.
  globalThis.indexedDB = new IDBFactory();
  resetDbConnection();
});

describe('브라우저 문서 저장소', () => {
  it('올린 문서를 저장하고 다시 읽는다(원본과 작업본이 같다)', async () => {
    const meta = await createDoc({ name: '보고서.txt', kind: 'txt', blob: blob('안녕') }, 1000);
    expect(meta).toMatchObject({ name: '보고서.txt', kind: 'txt', size: 6, edited: false, createdAt: 1000, openedAt: 1000 });
    const stored = await getDoc(meta.id);
    expect(stored).not.toBeNull();
    expect(await stored!.working.text()).toBe('안녕');
    expect(await stored!.original.text()).toBe('안녕');
  });

  it('없는 문서는 null', async () => {
    expect(await getDoc('nope')).toBeNull();
  });

  it('최근에 연 순서로 목록을 돌려주고, 열면 맨 위로 올라온다', async () => {
    const a = await createDoc({ name: 'a.txt', kind: 'txt', blob: blob('a') }, 1000);
    const b = await createDoc({ name: 'b.txt', kind: 'txt', blob: blob('b') }, 2000);
    expect((await listDocs()).map((d) => d.name)).toEqual(['b.txt', 'a.txt']);
    await touchOpened(a.id, 3000);
    expect((await listDocs()).map((d) => d.name)).toEqual(['a.txt', 'b.txt']);
    expect(b.id).not.toBe(a.id);
  });

  it('고친 내용은 작업본에만 저장하고 올린 원본은 그대로 둔다', async () => {
    const { id } = await createDoc({ name: 'a.txt', kind: 'txt', blob: blob('원본') }, 1000);
    const meta = await saveWorking(id, blob('수정한 글'), 2000);
    expect(meta).toMatchObject({ edited: true, updatedAt: 2000, size: new Blob(['수정한 글']).size });
    const stored = await getDoc(id);
    expect(await stored!.working.text()).toBe('수정한 글');
    expect(await stored!.original.text()).toBe('원본');
  });

  it('없는 문서에 저장하려 하면 실패하고 아무것도 만들지 않는다', async () => {
    await expect(saveWorking('nope', blob('x'))).rejects.toThrow();
    expect(await listDocs()).toEqual([]);
  });

  it('원본으로 되돌리면 작업본이 원본과 같아지고 고침 표시가 사라진다', async () => {
    const { id } = await createDoc({ name: 'a.txt', kind: 'txt', blob: blob('원본') }, 1000);
    await saveWorking(id, blob('고침'), 2000);
    const meta = await restoreOriginal(id, 3000);
    expect(meta.edited).toBe(false);
    expect(await (await getDoc(id))!.working.text()).toBe('원본');
  });

  it('지우면 목록과 파일이 모두 사라진다', async () => {
    const { id } = await createDoc({ name: 'a.txt', kind: 'txt', blob: blob('a') });
    await removeDoc(id);
    expect(await listDocs()).toEqual([]);
    expect(await getDoc(id)).toBeNull();
  });
});

describe('문서 검색', () => {
  it('이름에 검색어가 들어 있는 문서만 남긴다', async () => {
    const docs = [
      await createDoc({ name: '회의록 9월.hwp', kind: 'hwp', blob: blob('a') }),
      await createDoc({ name: 'Budget.DOCX', kind: 'docx', blob: blob('b') }),
    ];
    expect(filterDocs(docs, '회의').map((d) => d.name)).toEqual(['회의록 9월.hwp']);
    expect(filterDocs(docs, '  budget ').map((d) => d.name)).toEqual(['Budget.DOCX']);
    expect(filterDocs(docs, '')).toHaveLength(2);
    expect(filterDocs(docs, '없음')).toHaveLength(0);
  });
});
