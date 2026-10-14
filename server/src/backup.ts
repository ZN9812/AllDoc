// 하루 한 번 데이터 파일의 스냅숏을 만든다(VACUUM INTO: 서버를 멈추지 않고 일관된 사본 한 파일을 만든다).
// 최근 keep 개만 남긴다. 서버 밖으로 복사하는 일(restic·rclone 등)은 운영자가 따로 한다(docs/DEPLOY.md "백업").
import { mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const NAME = /^alldoc-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export interface BackupResult {
  file: string;
  created: boolean;
  removed: string[];
}

/** day(YYYY-MM-DD) 의 스냅숏이 없으면 만들고, 오래된 것을 지워 keep 개만 남긴다. */
export function backupOnce(db: DatabaseSync, dir: string, day: string, keep: number): BackupResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`날짜 형식이 아니에요: ${day}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `alldoc-${day}.sqlite`);
  let created = false;
  if (!existsSync(file)) {
    // 경로 안의 작은따옴표는 SQL 문자열 규칙대로 두 번 쓴다.
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    created = true;
  }
  const snapshots = readdirSync(dir)
    .filter((n) => NAME.test(n))
    .sort()
    .reverse();
  const removed = snapshots.slice(Math.max(keep, 1));
  for (const n of removed) rmSync(join(dir, n));
  return { file, created, removed };
}
