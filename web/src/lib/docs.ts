// 브라우저 저장소(IndexedDB). 문서는 이 브라우저에만 저장한다(LaTeX 프로젝트는 컴파일할 때만 파일을 서버로 보낸다, editor/tex/compile.ts).
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocKind, TexEngine } from '@alldoc/shared';

/** LaTeX 프로젝트 설정(kind === 'tex' 일 때만) */
export interface TexProjectMeta {
  /** 주 파일(컴파일할 .tex) */
  main: string;
  engine: TexEngine;
}

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
  /** LaTeX 프로젝트 설정. tex 가 아니면 없다 */
  project?: TexProjectMeta;
}

/** LaTeX 프로젝트의 파일 하나. 바뀐 파일만 다시 쓰도록 파일마다 따로 저장한다(docs/LATEX.md "데이터 모델"). */
export interface TexFileRecord {
  /** `${docId}/${path}` */
  key: string;
  docId: string;
  path: string;
  blob: Blob;
  /** 내용의 sha256(16진). 컴파일할 때 서버에 이미 올린 파일인지 대조하는 데 쓴다 */
  hash: string;
  updatedAt: number;
}

interface AllDocDB extends DBSchema {
  docs: { key: string; value: DocMeta; indexes: { 'by-opened': number } };
  /** 파일 본문. 목록을 읽을 때 큰 데이터를 끌어오지 않도록 메타와 분리한다. */
  files: { key: string; value: { key: string; blob: Blob } };
  /** 버전 2: LaTeX 프로젝트의 파일들. tex 문서의 files 에는 처음 올린 ZIP(원본)만 둔다 */
  texFiles: { key: string; value: TexFileRecord; indexes: { 'by-doc': string } };
}

const DB_NAME = 'alldoc';
/** 1: docs·files · 2: texFiles 추가 */
export const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<AllDocDB>> | null = null;

function db(): Promise<IDBPDatabase<AllDocDB>> {
  dbPromise ??= openDB<AllDocDB>(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        const docs = d.createObjectStore('docs', { keyPath: 'id' });
        docs.createIndex('by-opened', 'openedAt');
        d.createObjectStore('files', { keyPath: 'key' });
      }
      if (oldVersion < 2) {
        const tex = d.createObjectStore('texFiles', { keyPath: 'key' });
        tex.createIndex('by-doc', 'docId');
      }
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
  if (!original) return null;
  // LaTeX 프로젝트는 작업본 블롭이 없다(파일별로 texFiles 에 있다). 그때는 원본으로 대신한다.
  if (!working) return meta.kind === 'tex' ? { meta, working: original.blob, original: original.blob } : null;
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
  const tx = d.transaction(['docs', 'files', 'texFiles'], 'readwrite');
  const tex = tx.objectStore('texFiles');
  const keys = await tex.index('by-doc').getAllKeys(id);
  await Promise.all([
    tx.objectStore('docs').delete(id),
    tx.objectStore('files').delete(fileKey(id, 'original')),
    tx.objectStore('files').delete(fileKey(id, 'working')),
    ...keys.map((k) => tex.delete(k)),
    tx.done,
  ]);
}

// ---- LaTeX 프로젝트(kind === 'tex') ----

const texKey = (docId: string, path: string) => `${docId}/${path}`;

export interface NewTexFile {
  path: string;
  blob: Blob;
  hash: string;
}

const projectSize = (files: Array<{ blob: Blob }>) => files.reduce((n, f) => n + f.blob.size, 0);

/** LaTeX 프로젝트를 만든다. original 은 처음 올린 ZIP(또는 .tex) 그대로이고, "원본으로 되돌리기"에 쓴다. */
export async function createTexDoc(
  input: { name: string; original: Blob; files: NewTexFile[]; project: TexProjectMeta },
  now: number = Date.now(),
): Promise<DocMeta> {
  const meta: DocMeta = {
    id: crypto.randomUUID(),
    name: input.name,
    kind: 'tex',
    size: projectSize(input.files),
    createdAt: now,
    updatedAt: now,
    openedAt: now,
    edited: false,
    project: input.project,
  };
  const d = await db();
  const tx = d.transaction(['docs', 'files', 'texFiles'], 'readwrite');
  await Promise.all([
    tx.objectStore('docs').put(meta),
    tx.objectStore('files').put({ key: fileKey(meta.id, 'original'), blob: input.original }),
    ...input.files.map((f) => tx.objectStore('texFiles').put({ key: texKey(meta.id, f.path), docId: meta.id, path: f.path, blob: f.blob, hash: f.hash, updatedAt: now })),
    tx.done,
  ]);
  return meta;
}

/** 프로젝트의 파일 목록(경로 순) */
export async function listTexFiles(docId: string): Promise<TexFileRecord[]> {
  const d = await db();
  const all = await d.getAllFromIndex('texFiles', 'by-doc', docId);
  return all.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** 프로젝트 파일을 바꾼다. upsert 는 쓰거나 새로 만들 파일, remove 는 지울 경로. 문서 크기·고친 시각도 함께 갱신한다. */
export async function updateTexFiles(
  docId: string,
  change: { upsert?: NewTexFile[]; remove?: string[]; project?: Partial<TexProjectMeta> },
  now: number = Date.now(),
): Promise<DocMeta> {
  const d = await db();
  const tx = d.transaction(['docs', 'texFiles'], 'readwrite');
  const meta = await tx.objectStore('docs').get(docId);
  if (!meta || meta.kind !== 'tex') {
    abortQuietly(tx);
    throw new Error('프로젝트를 찾을 수 없어요.');
  }
  const store = tx.objectStore('texFiles');
  for (const p of change.remove ?? []) await store.delete(texKey(docId, p));
  for (const f of change.upsert ?? []) await store.put({ key: texKey(docId, f.path), docId, path: f.path, blob: f.blob, hash: f.hash, updatedAt: now });
  const all = await store.index('by-doc').getAll(docId);
  const project = { ...(meta.project as TexProjectMeta), ...change.project };
  const next: DocMeta = { ...meta, size: projectSize(all), updatedAt: now, edited: true, project };
  await Promise.all([tx.objectStore('docs').put(next), tx.done]);
  return next;
}

/** 프로젝트 파일을 모두 바꿔 넣는다(원본으로 되돌리기). edited 는 false 가 된다. */
export async function replaceTexFiles(docId: string, files: NewTexFile[], project: TexProjectMeta, now: number = Date.now()): Promise<DocMeta> {
  const d = await db();
  const tx = d.transaction(['docs', 'texFiles'], 'readwrite');
  const meta = await tx.objectStore('docs').get(docId);
  if (!meta || meta.kind !== 'tex') {
    abortQuietly(tx);
    throw new Error('프로젝트를 찾을 수 없어요.');
  }
  const store = tx.objectStore('texFiles');
  for (const k of await store.index('by-doc').getAllKeys(docId)) await store.delete(k);
  for (const f of files) await store.put({ key: texKey(docId, f.path), docId, path: f.path, blob: f.blob, hash: f.hash, updatedAt: now });
  const next: DocMeta = { ...meta, size: projectSize(files), updatedAt: now, edited: false, project };
  await Promise.all([tx.objectStore('docs').put(next), tx.done]);
  return next;
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
