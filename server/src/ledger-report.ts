// 원장 보고(가격 근거): 기간 동안 ① AI 작업·모델별 1건 원가·토큰·시간 p50/p95 ② 엔진별 컴파일 시간 p50/p95
// ③ 사용자당 하루·월 사용량 분포(AI 횟수·원가, 컴파일 횟수·시간)를 보여 준다. 문서 글은 원장에 없으므로 보고에도 없다.
//   node --disable-warning=ExperimentalWarning server/dist/ledger-report.js [--days 7] [--from YYYY-MM-DD --to YYYY-MM-DD] [--json]
// 데이터 폴더는 DATA_DIR(기본 ./data)를 따른다. 컨테이너에서는 docker exec 로 같은 명령을 돌린다.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRICES_AS_OF } from './ai/pricing';
import { openDb } from './db';
import { LedgerStore, type CompileSummaryRow, type CostSummaryRow, type Distribution, type UserUsageSummary } from './ledger';
import { dayKey } from './quota';

export function parseArgs(argv: string[], now: Date, timezone: string): { from: string; to: string; json: boolean } {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const days = Number(get('--days') ?? 7);
  if (!Number.isInteger(days) || days < 1) throw new Error('--days 는 1 이상의 정수여야 해요.');
  const to = get('--to') ?? dayKey(now, timezone);
  const from = get('--from') ?? dayKey(new Date(now.getTime() - (days - 1) * 86_400_000), timezone);
  for (const d of [from, to]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`날짜는 YYYY-MM-DD 로 적어 주세요: ${d}`);
  return { from, to, json: argv.includes('--json') };
}

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(4)}`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString('en-US')}KB`;

export function formatReport(rows: CostSummaryRow[], from: string, to: string): string {
  const lines = [`AI 원가 보고 ${from} ~ ${to} (단가표 기준일 ${PRICES_AS_OF})`];
  if (rows.length === 0) return [...lines, '기록이 없어요.'].join('\n');
  for (const r of rows) {
    lines.push(
      `- ${r.task} · ${r.model}: 요청 ${r.requests}건(성공 ${r.ok}, 대체 모델 ${r.fallbacks}, 사용량 모름 ${r.noUsage}) · 합계 ${usd(r.totalMicroUsd)} · 1건 p50 ${usd(r.p50MicroUsd)} / p95 ${usd(r.p95MicroUsd)} · 평균 토큰 입력 ${r.avgInputTokens} / 출력 ${r.avgOutputTokens} / 캐시 읽기 ${r.avgCacheReadTokens}`,
      `    토큰 p50/p95 입력 ${r.p50InputTokens}/${r.p95InputTokens} · 출력 ${r.p50OutputTokens}/${r.p95OutputTokens} · 걸린 시간 p50 ${sec(r.p50Ms)} / p95 ${sec(r.p95Ms)}`,
    );
  }
  const total = rows.reduce((n, r) => n + r.totalMicroUsd, 0);
  lines.push(`합계 ${usd(total)}`);
  return lines.join('\n');
}

export function formatCompileReport(rows: CompileSummaryRow[]): string {
  const lines = ['LaTeX 컴파일(시간·크기는 일꾼이 실제로 돌린 것만)'];
  if (rows.length === 0) return [...lines, '기록이 없어요.'].join('\n');
  for (const r of rows) {
    const outcomes = Object.entries(r.outcomes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    lines.push(
      `- ${r.engine}: 요청 ${r.requests}건(${outcomes}) · 실제 실행 ${r.runs}건 · 시간 p50 ${sec(r.p50WallMs)} / p95 ${sec(r.p95WallMs)} / 최대 ${sec(r.maxWallMs)} · 프로젝트 p50 ${kb(r.p50ProjectBytes)} / p95 ${kb(r.p95ProjectBytes)} · PDF p50 ${kb(r.p50PdfBytes)}`,
    );
  }
  return lines.join('\n');
}

const dist = (d: Distribution, f: (n: number) => string = String) => (d.n === 0 ? '기록 없음' : `p50 ${f(d.p50)} / p95 ${f(d.p95)} / 최대 ${f(d.max)} (${d.n}건)`);

export function formatUserReport(u: UserUsageSummary): string {
  const s = (n: number) => `${n}초`;
  return [
    `사용자당 사용량(쓴 날·달만, 로그인 없이 쓴 줄 제외) · 쓴 사용자 ${u.activeUsers}명`,
    `- AI 하루 횟수 ${dist(u.aiPerUserDay.requests)} · 하루 원가 ${dist(u.aiPerUserDay.costMicroUsd, usd)}`,
    `- AI 월 횟수 ${dist(u.aiPerUserMonth.requests)} · 월 원가 ${dist(u.aiPerUserMonth.costMicroUsd, usd)}`,
    `- 컴파일 하루 횟수 ${dist(u.compilePerUserDay.runs)} · 하루 시간 ${dist(u.compilePerUserDay.seconds, s)}`,
    `- 컴파일 월 횟수 ${dist(u.compilePerUserMonth.runs)} · 월 시간 ${dist(u.compilePerUserMonth.seconds, s)}`,
    '  (기간이 달의 일부만 덮으면 그 달 값은 덮은 날만 센 것이에요.)',
  ].join('\n');
}

/** 세 부분을 합친 가격 근거 보고(글과 JSON) */
export function buildReport(ledger: LedgerStore, from: string, to: string) {
  const ai = ledger.summary(from, to);
  const compile = ledger.compileSummary(from, to);
  const users = ledger.userUsage(from, to);
  return {
    json: { from, to, pricesAsOf: PRICES_AS_OF, rows: ai, compile, users },
    text: [formatReport(ai, from, to), formatCompileReport(compile), formatUserReport(users)].join('\n\n'),
  };
}

// 직접 실행했을 때만 돈다(시험에서 불러올 때는 돌지 않는다).
if (process.argv[1] && /ledger-report\.(js|ts)$/.test(process.argv[1])) {
  const timezone = process.env.APP_TIMEZONE ?? 'Asia/Seoul';
  const file = join(resolve(process.env.DATA_DIR ?? './data'), 'alldoc.sqlite');
  try {
    if (!existsSync(file)) throw new Error(`원장 파일이 없어요: ${file} (DATA_DIR 를 확인하세요)`);
    const { from, to, json } = parseArgs(process.argv.slice(2), new Date(), timezone);
    const db = openDb(file);
    const report = buildReport(new LedgerStore(db), from, to);
    db.close();
    console.log(json ? JSON.stringify(report.json, null, 2) : report.text);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
