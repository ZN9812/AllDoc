// AI 원장 보고: 기간 동안 작업·모델별 요청 수와 원가(p50/p95)를 보여 준다.
//   node --disable-warning=ExperimentalWarning server/dist/ledger-report.js [--days 7] [--from YYYY-MM-DD --to YYYY-MM-DD] [--json]
// 데이터 폴더는 DATA_DIR(기본 ./data)를 따른다. 컨테이너에서는 docker exec 로 같은 명령을 돌린다.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRICES_AS_OF } from './ai/pricing';
import { LedgerStore, type CostSummaryRow } from './ledger';
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

export function formatReport(rows: CostSummaryRow[], from: string, to: string): string {
  const lines = [`AI 원가 보고 ${from} ~ ${to} (단가표 기준일 ${PRICES_AS_OF})`];
  if (rows.length === 0) return [...lines, '기록이 없어요.'].join('\n');
  for (const r of rows) {
    lines.push(
      `- ${r.task} · ${r.model}: 요청 ${r.requests}건(성공 ${r.ok}, 대체 모델 ${r.fallbacks}, 사용량 모름 ${r.noUsage}) · 합계 ${usd(r.totalMicroUsd)} · 1건 p50 ${usd(r.p50MicroUsd)} / p95 ${usd(r.p95MicroUsd)} · 평균 토큰 입력 ${r.avgInputTokens} / 출력 ${r.avgOutputTokens} / 캐시 읽기 ${r.avgCacheReadTokens}`,
    );
  }
  const total = rows.reduce((n, r) => n + r.totalMicroUsd, 0);
  lines.push(`합계 ${usd(total)}`);
  return lines.join('\n');
}

// 직접 실행했을 때만 돈다(시험에서 불러올 때는 돌지 않는다).
if (process.argv[1] && /ledger-report\.(js|ts)$/.test(process.argv[1])) {
  const timezone = process.env.APP_TIMEZONE ?? 'Asia/Seoul';
  const file = join(resolve(process.env.DATA_DIR ?? './data'), 'alldoc.sqlite');
  try {
    if (!existsSync(file)) throw new Error(`원장 파일이 없어요: ${file} (DATA_DIR 를 확인하세요)`);
    const { from, to, json } = parseArgs(process.argv.slice(2), new Date(), timezone);
    const ledger = new LedgerStore(file);
    const rows = ledger.summary(from, to);
    ledger.close();
    console.log(json ? JSON.stringify({ from, to, pricesAsOf: PRICES_AS_OF, rows }, null, 2) : formatReport(rows, from, to));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
