import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, openDb } from './index';

const version = (db: DatabaseSync) => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
const tables = (db: DatabaseSync) => (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);

describe('데이터 파일 마이그레이션', () => {
  it('새 파일은 끝까지 올리고, 다시 열어도 그대로다', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'alldoc-db-')), 'alldoc.sqlite');
    const db = openDb(file);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(tables(db)).toEqual(['ai_events', 'audit_log', 'compile_events', 'entitlement_overrides', 'invites', 'tex_blobs', 'usage', 'user_blobs', 'users']);
    db.close();
    const again = openDb(file);
    expect(version(again)).toBe(MIGRATIONS.length);
    again.close();
  });

  it('마이그레이션 도입 전의 옛 파일(usage·ai_events 만 있고 버전 0)도 기록을 지키며 올린다', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'alldoc-db-')), 'alldoc.sqlite');
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE usage (user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (user_id, day))');
    old.exec("INSERT INTO usage VALUES ('g:1', '2026-10-01', 4)");
    old.close();
    const db = openDb(file);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT count FROM usage').get()).toEqual({ count: 4 });
    db.close();
  });

  it('M1 까지의 파일(버전 3)에 4번(컴파일 원장·올린 파일)을 더해도 기존 기록이 남는다', () => {
    const db = new DatabaseSync(':memory:');
    for (let v = 0; v < 3; v++) db.exec(MIGRATIONS[v] as string);
    db.exec('PRAGMA user_version = 3');
    db.exec("INSERT INTO users (id, created_at, last_login_at) VALUES ('g:1', 1, 1)");
    migrate(db);
    expect(version(db)).toBe(MIGRATIONS.length);
    expect(db.prepare('SELECT id FROM users').all()).toEqual([{ id: 'g:1' }]);
    expect(tables(db)).toContain('compile_events');
  });

  it('M3 까지의 파일(버전 4)에 5번(베타 초대)을 더하면 기존 계정은 초대 없음(invite_id NULL)으로 남는다', () => {
    const db = new DatabaseSync(':memory:');
    for (let v = 0; v < 4; v++) db.exec(MIGRATIONS[v] as string);
    db.exec('PRAGMA user_version = 4');
    db.exec("INSERT INTO users (id, created_at, last_login_at) VALUES ('g:1', 1, 1)");
    migrate(db);
    expect(version(db)).toBe(5);
    expect(db.prepare('SELECT id, invite_id FROM users').all()).toEqual([{ id: 'g:1', invite_id: null }]);
    expect(tables(db)).toContain('invites');
  });

  it('서버보다 새 버전의 파일은 열지 않는다', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    expect(() => migrate(db)).toThrow('새 버전');
  });

  it('중간에 실패한 마이그레이션은 되돌리고 버전을 올리지 않는다', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE audit_log (id INTEGER)'); // 3번의 뒤쪽 문장이 실패하게 한다(앞쪽 users 는 이미 만들어진 뒤)
    expect(() => migrate(db)).toThrow();
    expect(version(db)).toBe(2);
    expect(tables(db)).not.toContain('users');
  });
});
