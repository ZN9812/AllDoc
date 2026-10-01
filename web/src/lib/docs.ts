// 브라우저 저장소(IndexedDB). 문서는 서버로 보내지 않고 이 브라우저에만 저장한다.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocKind } from '@alldoc/shared';

export interface DocMeta {
  id: string;
  name: string;
  kind: DocKind;
  size: number;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  /** 올린 뒤 고친 적이 있는지(내려받을 때 "_수정본" 이름을 붙인다) */
  edited: boolean;
}

interface AllDocDB extends DBSchema {
  docs: { key: string; value: DocMeta; indexes: { 'by-opened': number } };
  /** 파일 본문. 목록을 읽을 때 큰 데이터를 끌어오지 않도록 메타와 분리한다. */
  files: { key: string; value: { key: string; blob: Blob } };
}

const DB_NAME = 'alldoc';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AllDocDB>> | null = null;

function db(): Promise<IDBPDatabase<AllDocDB>> {
  dbPromise ??= openDB<AllDocDB>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      const docs = d.createObjectStore('docs', { keyPath: 'id' });
      docs.createIndex('by-opened', 'openedAt');
      d.createObjectStore('files', { keyPath: 'key' });
    },
  });
  return dbPromise;
}

/** 시험에서 저장소를 새로 열 때 쓴다. */
export function resetDbConnection(): void {
  dbPromise = null;
}

const fileKey = (id: string, which: 'original' | 'working') => `${id}/${which}`;

/** 트랜잭션을 중단한다. 중단하면 done 이 거부되는데, 우리가 일부러 한 것이므로 조용히 넘긴다. */
function abortQuietly(tx: { abort(): void; done: Promise<void> }): void {
  tx.done.catch(() => undefined);
  tx.abort();
}

export async function createDoc(input: { name: string; kind: DocKind; blob: Blob }, now: number = Date.now()): Promise<DocMeta> {
  const meta: DocMeta = {
    id: crypto.randomUUID(),
    name: input.name,
    kind: input.kind,
    size: input.blob.size,
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    edited: false,
  };
  const d = await db();
  const tx = d.transaction(['docs', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('docs').put(meta),
    tx.objectStore('files').put({ key: fileKey(meta.id, 'original'), blob: input.blob }),
    tx.objectStore('files').put({ key: fileKey(meta.id, 'working'), blob: input.blob }),
    tx.done,
  ]);
  return meta;
}

/** 최근에 연 순서로 돌려준다. */
export async function listDocs(): Promise<DocMeta[]> {
  const d = await db();
  const all = await d.getAllFromIndex('docs', 'by-opened');
  return all.reverse();
}

export interface StoredDoc {
  meta: DocMeta;
  working: Blob;
  original: Blob;
}

export async function getDoc(id: string): Promise<StoredDoc | null> {
  const d = await db();
  const meta = await d.get('docs', id);
  if (!meta) return null;
  const [working, original] = await Promise.all([d.get('files', fileKey(id, 'working')), d.get('files', fileKey(id, 'original'))]);
  if (!working || !original) return null;
  return { meta, working: working.blob, original: original.blob };
}

export async function touchOpened(id: string, now: number = Date.now()): Promise<void> {
  const d = await db();
  const meta = await d.get('docs', id);
  if (meta) await d.put('docs', { ...meta, openedAt: now });
}

/** 고친 내용을 저장한다. 원본(original)은 건드리지 않는다. */
export async function saveWorking(id: string, blob: Blob, now: number = Date.now()): Promise<DocMeta> {
  const d = await db();
  const tx = d.transaction(['docs', 'files'], 'readwrite');
  const meta = await tx.objectStore('docs').get(id);
  if (!meta) {
    abortQuietly(tx);
    throw new Error('문서를 찾을 수 없어요.');
  }
  const next: DocMeta = { ...meta, size: blob.size, updatedAt: now, edited: true };
  await Promise.all([tx.objectStore('docs').put(next), tx.objectStore('files').put({ key: fileKey(id, 'working'), blob }), tx.done]);
  return next;
}

/** 고친 내용을 버리고 올렸던 원본으로 돌린다. */
export async function restoreOriginal(id: string, now: number = Date.now()): Promise<DocMeta> {
  const d = await db();
  const tx = d.transaction(['docs', 'files'], 'readwrite');
  const [meta, original] = await Promise.all([tx.objectStore('docs').get(id), tx.objectStore('files').get(fileKey(id, 'original'))]);
  if (!meta || !original) {
    abortQuietly(tx);
    throw new Error('원본을 찾을 수 없어요.');
  }
  const next: DocMeta = { ...meta, size: original.blob.size, updatedAt: now, edited: false };
  await Promise.all([tx.objectStore('docs').put(next), tx.objectStore('files').put({ key: fileKey(id, 'working'), blob: original.blob }), tx.done]);
  return next;
}

export async function removeDoc(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'files'], 'readwrite');
  await Promise.all([
    tx.objectStore('docs').delete(id),
    tx.objectStore('files').delete(fileKey(id, 'original')),
    tx.objectStore('files').delete(fileKey(id, 'working')),
    tx.done,
  ]);
}

/** 저장 공간이 부족해서 실패했는지 */
export function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/** 문서 이름에 검색어가 들어 있는 것만 남긴다(대소문자·띄어쓰기 앞뒤 공백 무시). */
export function filterDocs(docs: DocMeta[], query: string): DocMeta[] {
  const q = query.normalize('NFC').trim().toLowerCase();
  if (!q) return docs;
  return docs.filter((d) => d.name.normalize('NFC').toLowerCase().includes(q));
}
