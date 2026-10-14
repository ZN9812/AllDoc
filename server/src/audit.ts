// 관리 기록. 관리자 CLI 명령과 탈퇴처럼 되돌리기 어려운 일을 누가 언제 했는지 남긴다.
import type { DatabaseSync } from 'node:sqlite';

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  target: string | null;
  detail: string | null;
}

export class AuditLog {
  private readonly insertStmt;
  private readonly recentStmt;

  constructor(db: DatabaseSync) {
    this.insertStmt = db.prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)');
    this.recentStmt = db.prepare('SELECT at, actor, action, target, detail FROM audit_log WHERE target = ? OR ? IS NULL ORDER BY id DESC LIMIT ?');
  }

  record(e: AuditEntry): void {
    this.insertStmt.run(e.at, e.actor, e.action, e.target, e.detail);
  }

  recent(target: string | null, limit = 20): AuditEntry[] {
    return this.recentStmt.all(target, target, limit) as unknown as AuditEntry[];
  }
}
