import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccountStore } from './auth/accounts';
import { backupOnce } from './backup';
import { openDb } from './db';

describe('백업 스냅숏', () => {
  it('그날 스냅숏을 만들고, 다시 부르면 만들지 않으며, 스냅숏을 열면 같은 자료가 있다', () => {
    const base = mkdtempSync(join(tmpdir(), "alldoc-bk-it's-"));
    const db = openDb(join(base, 'alldoc.sqlite'));
    new AccountStore(db).login({ id: 'g:1', name: '홍길동', email: 'a@b.c' }, 1);
    const dir = join(base, 'backups');
    const first = backupOnce(db, dir, '2026-10-14', 14);
    expect(first.created).toBe(true);
    expect(backupOnce(db, dir, '2026-10-14', 14).created).toBe(false);
    db.close();
    const restored = openDb(first.file);
    expect(new AccountStore(restored).get('g:1')?.email).toBe('a@b.c');
    restored.close();
  });

  it('최근 keep 개만 남기고, 이름 규칙에 맞지 않는 파일은 건드리지 않는다', () => {
    const base = mkdtempSync(join(tmpdir(), 'alldoc-bk-'));
    const dir = join(base, 'backups');
    const db = openDb(':memory:');
    for (const d of ['2026-10-10', '2026-10-11', '2026-10-12']) backupOnce(db, dir, d, 99);
    writeFileSync(join(dir, 'memo.txt'), '운영자 메모');
    const r = backupOnce(db, dir, '2026-10-13', 2);
    expect(r.removed).toEqual(['alldoc-2026-10-11.sqlite', 'alldoc-2026-10-10.sqlite']);
    expect(readdirSync(dir).sort()).toEqual(['alldoc-2026-10-12.sqlite', 'alldoc-2026-10-13.sqlite', 'memo.txt']);
    expect(existsSync(join(dir, 'memo.txt'))).toBe(true);
  });

  it('날짜가 아닌 값은 거절한다', () => {
    expect(() => backupOnce(openDb(':memory:'), mkdtempSync(join(tmpdir(), 'alldoc-bk-')), "x'; DROP TABLE users; --", 1)).toThrow('날짜');
  });
});
