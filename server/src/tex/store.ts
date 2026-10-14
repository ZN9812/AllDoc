// 컴파일하려고 올린 파일(내용 해시 이름)과 만든 PDF를 서버 디스크에 잠시 둔다.
//   DATA_DIR/tex/blobs/ab/<sha256>   올린 파일. 누가 올렸는지는 user_blobs 에 남긴다(해시 대조는 그 사용자 것만).
//   DATA_DIR/tex/out/<jobId>.pdf      만든 PDF. 만든 사람만 받는다. 1시간 뒤 지운다.
// 올린 파일은 그 사용자가 마지막으로 쓴(올리거나 컴파일한) 뒤 retentionDays 가 지나면 지운다.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/** AUTH_MODE=none(로그인 없는 설치)에서 모두가 함께 쓰는 사용자 칸 */
export const ANONYMOUS_SCOPE = '';
/** 만든 PDF를 두는 시간 */
export const OUTPUT_TTL_MS = 60 * 60 * 1000;

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

interface OutputEntry {
  userId: string;
  file: string;
  bytes: number;
  at: number;
}

export class TexStore {
  private readonly blobDir: string;
  private readonly outDir: string;
  private readonly ownStmt;
  private readonly touchStmt;
  private readonly upsertBlobStmt;
  private readonly hasBlobStmt;
  private readonly outputs = new Map<string, OutputEntry>();
  /** 사용자별 결과 캐시: 키(파일 목록·엔진·주 파일·TeX 판) → jobId */
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly db: DatabaseSync,
    dataDir: string,
  ) {
    this.blobDir = join(dataDir, 'tex', 'blobs');
    this.outDir = join(dataDir, 'tex', 'out');
    mkdirSync(this.blobDir, { recursive: true });
    mkdirSync(this.outDir, { recursive: true });
    this.ownStmt = db.prepare('SELECT 1 FROM user_blobs WHERE user_id = ? AND hash = ?');
    this.touchStmt = db.prepare(
      'INSERT INTO user_blobs (user_id, hash, at) VALUES (?, ?, ?) ON CONFLICT (user_id, hash) DO UPDATE SET at = excluded.at',
    );
    this.upsertBlobStmt = db.prepare(
      'INSERT INTO tex_blobs (hash, size, created_at) VALUES (?, ?, ?) ON CONFLICT (hash) DO NOTHING',
    );
    this.hasBlobStmt = db.prepare('SELECT size FROM tex_blobs WHERE hash = ?');
  }

  private blobPath(hash: string): string {
    return join(this.blobDir, hash.slice(0, 2), hash);
  }

  /** 이 사용자가 올린 적이 있고 파일이 아직 있는지 */
  owns(userId: string, hash: string): boolean {
    return this.ownStmt.get(userId, hash) !== undefined && this.hasBlobStmt.get(hash) !== undefined;
  }

  /** 이 사용자가 아직 올리지 않은 해시만 돌려준다(다른 사람이 같은 파일을 올렸는지는 알려 주지 않는다). */
  missing(userId: string, hashes: string[]): string[] {
    return [...new Set(hashes)].filter((h) => !this.owns(userId, h));
  }

  /** 받은 바이트를 저장한다. 해시가 맞지 않으면 false. */
  put(userId: string, hash: string, bytes: Uint8Array, now: number): boolean {
    if (sha256Hex(bytes) !== hash) return false;
    if (this.hasBlobStmt.get(hash) === undefined) {
      const p = this.blobPath(hash);
      mkdirSync(join(this.blobDir, hash.slice(0, 2)), { recursive: true });
      const tmp = `${p}.${process.pid}.${now}.tmp`;
      writeFileSync(tmp, bytes);
      renameSync(tmp, p);
      this.upsertBlobStmt.run(hash, bytes.byteLength, now);
    }
    this.touchStmt.run(userId, hash, now);
    return true;
  }

  /** 컴파일에 쓴 파일의 "마지막 사용" 시각을 갱신하고 바이트를 읽는다. 없으면 null. */
  read(userId: string, hash: string, now: number): Uint8Array | null {
    if (!this.owns(userId, hash)) return null;
    try {
      const b = new Uint8Array(readFileSync(this.blobPath(hash)));
      this.touchStmt.run(userId, hash, now);
      return b;
    } catch {
      return null;
    }
  }

  saveOutput(jobId: string, userId: string, pdf: Uint8Array, now: number): void {
    const file = join(this.outDir, `${jobId}.pdf`);
    writeFileSync(file, pdf);
    this.outputs.set(jobId, { userId, file, bytes: pdf.byteLength, at: now });
  }

  /** 만든 사람만 받는다. 다른 사람의 jobId 면 없는 것처럼 null. */
  readOutput(jobId: string, userId: string, now: number): Uint8Array | null {
    const e = this.outputs.get(jobId);
    if (!e || e.userId !== userId || now - e.at > OUTPUT_TTL_MS) return null;
    try {
      return new Uint8Array(readFileSync(e.file));
    } catch {
      return null;
    }
  }

  cached(userId: string, key: string, now: number): string | null {
    const jobId = this.cache.get(`${userId}\u0000${key}`);
    if (!jobId) return null;
    const e = this.outputs.get(jobId);
    return e && e.userId === userId && now - e.at <= OUTPUT_TTL_MS ? jobId : null;
  }

  remember(userId: string, key: string, jobId: string): void {
    this.cache.set(`${userId}\u0000${key}`, jobId);
  }

  /** 탈퇴: 이 사용자가 올린 기록과 PDF를 지운다. 아무도 쓰지 않는 파일은 다음 prune 에서 지워진다. */
  forgetUser(userId: string): number {
    for (const [id, e] of this.outputs) {
      if (e.userId !== userId) continue;
      rmSync(e.file, { force: true });
      this.outputs.delete(id);
    }
    for (const k of this.cache.keys()) if (k.startsWith(`${userId}\u0000`)) this.cache.delete(k);
    return Number(this.db.prepare('DELETE FROM user_blobs WHERE user_id = ?').run(userId).changes);
  }

  /**
   * 보관 기간이 지난 것을 지운다: 마지막 사용이 cutoff 보다 이른 user_blobs, 아무도 쓰지 않는 파일, 1시간 지난 PDF.
   * 서버가 다시 켜져 목록을 잃은 PDF 도 파일 시각으로 지운다. 지운 파일 수를 돌려준다.
   */
  prune(now: number, retentionDays: number): { blobs: number; outputs: number } {
    this.db.prepare('DELETE FROM user_blobs WHERE at < ?').run(now - retentionDays * 86_400_000);
    const orphans = this.db.prepare('SELECT hash FROM tex_blobs WHERE hash NOT IN (SELECT hash FROM user_blobs)').all() as Array<{ hash: string }>;
    for (const { hash } of orphans) {
      rmSync(this.blobPath(hash), { force: true });
      this.db.prepare('DELETE FROM tex_blobs WHERE hash = ?').run(hash);
    }
    let outputs = 0;
    for (const [id, e] of this.outputs) {
      if (now - e.at <= OUTPUT_TTL_MS) continue;
      rmSync(e.file, { force: true });
      this.outputs.delete(id);
      outputs++;
    }
    const known = new Set([...this.outputs.values()].map((e) => e.file));
    for (const name of readdirSync(this.outDir)) {
      const f = join(this.outDir, name);
      if (known.has(f)) continue;
      try {
        if (now - statSync(f).mtimeMs > OUTPUT_TTL_MS) {
          rmSync(f, { force: true });
          outputs++;
        }
      } catch {
        // 그 사이 지워졌으면 넘어간다.
      }
    }
    for (const [k, jobId] of this.cache) if (!this.outputs.has(jobId)) this.cache.delete(k);
    return { blobs: orphans.length, outputs };
  }
}
