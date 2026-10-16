// 진짜 Claude 호출 확인(M0 ③). 작업 4개(chat·format_check·tex_chat·tex_fix)에 정해 둔 작은 예시 문서를 실제 API 로 보내고,
// 응답 모양·사용량·캐시 적중·대체 모델 옵션 수락·원가를 확인한다. 돈이 들므로 --yes 가 있어야 돈다.
//   ANTHROPIC_API_KEY=... node --disable-warning=ExperimentalWarning server/dist/live-check.js --yes [--repeat 2] [--tasks chat,tex_fix] [--out 결과.json]
// 설정(AI_CONFIG_PATH 의 모델·추론 강도·캐시 범위)은 서버와 같다. 기록은 임시(메모리) 원장에만 남고 서버 데이터 파일은 건드리지 않는다.
// 결과에는 숫자·모델 이름·응답 종료 이유만 담는다(예시 문서도 지어낸 글이다).
import Anthropic from '@anthropic-ai/sdk';
import { AI_TASKS, AiRequestSchema, splitTex, type AiRequest, type AiTask, type DocSummary } from '@alldoc/shared';
import { AnthropicProvider, type AnthropicLike } from './ai/anthropic';
import { toProposals } from './ai/convert';
import { ProviderFailedError, ProviderRefusedError, type ProviderUsage } from './ai/types';
import type { AiTaskSettings } from './config';
import { openDb } from './db';
import { LedgerStore, type AiOutcome } from './ledger';
import { buildReport } from './ledger-report';

const TEX_SRC = ['\\documentclass{article}', '\\usepackage{kotex}', '\\begin{document}', '몇일 뒤에 실험 결과를 정리 할 예정이다.', '', '\\begin{itemise}', '\\item 첫째 결과', '\\end{itemise}', '\\end{document}'].join('\n');

function texDoc(): DocSummary {
  return {
    kind: 'tex',
    paragraphs: splitTex(TEX_SRC, 'main.tex', 0, true).map((b) => ({ index: b.index, text: b.text, char: {}, para: {}, src: { file: b.file, line: b.line, role: b.role } })),
  };
}

/** 작업별 예시 요청(지어낸 짧은 글). 서버가 받는 것과 같은 스키마로 검사한다. */
export function sampleRequest(task: AiTask): AiRequest {
  const raw: AiRequest =
    task === 'chat'
      ? {
          mode: 'chat',
          instruction: '맞춤법과 띄어쓰기를 고쳐 줘',
          document: {
            kind: 'docx',
            paragraphs: [
              { index: 0, text: '회의는 몇일 뒤에 열릴 예정 입니다.', char: { fontFamily: '맑은 고딕', fontSizePt: 11 }, para: { lineSpacingPct: 160 } },
              { index: 1, text: '자료는 미리 준비 할려고 합니다.', char: { fontFamily: '맑은 고딕', fontSizePt: 11 }, para: { lineSpacingPct: 160 } },
            ],
          },
        }
      : task === 'format_check'
        ? {
            mode: 'format_check',
            instruction: '',
            criteria: 'consistency',
            document: {
              kind: 'hwpx',
              paragraphs: [
                { index: 0, text: '첫째 문단은 본문 서식입니다.', char: { fontFamily: '함초롬바탕', fontSizePt: 10 }, para: { lineSpacingPct: 160, align: 'justify' } },
                { index: 1, text: '둘째 문단도 본문입니다.', char: { fontFamily: '함초롬바탕', fontSizePt: 10 }, para: { lineSpacingPct: 160, align: 'justify' } },
                { index: 2, text: '셋째 문단만 글꼴과 크기가 다릅니다.', char: { fontFamily: '굴림', fontSizePt: 12 }, para: { lineSpacingPct: 130, align: 'justify' } },
              ],
            },
          }
        : task === 'tex_chat'
          ? { mode: 'chat', instruction: '본문의 맞춤법을 고쳐 줘', document: texDoc() }
          : {
              mode: 'tex_fix',
              instruction: '',
              document: texDoc(),
              compile: {
                diagnostics: [{ severity: 'error', file: 'main.tex', line: 6, message: 'LaTeX Error: Environment itemise undefined.' }],
                logExcerpt: '! LaTeX Error: Environment itemise undefined.\nl.6 \\begin{itemise}',
              },
            };
  return AiRequestSchema.parse(raw);
}

/** 응답에서 남기는 것: 모델 이름·종료 이유·usage(숫자와 항목 종류). 글은 남기지 않는다. */
export interface RawCallRecord {
  endpoint: 'messages' | 'beta.messages';
  model: string | null;
  stopReason: string | null;
  usage: unknown;
}

/** 실제 클라이언트를 감싸 응답의 숫자 부분만 기록한다. */
export function recordingClient(inner: AnthropicLike, sink: RawCallRecord[]): AnthropicLike {
  const keep = (endpoint: RawCallRecord['endpoint']) => (m: { model?: string; stop_reason: string | null; usage?: unknown }) => {
    sink.push({ endpoint, model: m.model ?? null, stopReason: m.stop_reason, usage: m.usage ?? null });
    return m;
  };
  return {
    messages: { parse: (p, o) => Promise.resolve(inner.messages.parse(p, o)).then(keep('messages')) },
    beta: { messages: { parse: (p, o) => Promise.resolve(inner.beta.messages.parse(p, o)).then(keep('beta.messages')) } },
  } as AnthropicLike;
}

export interface CallResult {
  task: AiTask;
  attempt: number;
  outcome: AiOutcome;
  error: string | null;
  ms: number;
  modelServed: string | null;
  fallback: boolean;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  costMicroUsd: number | null;
  proposals: number;
  dropped: number;
  /** 이 호출에서 실제 API 에 간 요청들(대체 모델 옵션을 거절당해 다시 보낸 것 포함) */
  raw: RawCallRecord[];
}

export interface LiveCheckResult {
  at: string;
  calls: CallResult[];
  warnings: string[];
  checks: {
    allOk: boolean;
    usageReported: boolean;
    /** 대체 모델 옵션(베타)을 보낸 요청이 받아들여졌는지. 설정에서 끈 작업은 빠진다(null 이면 해당 없음) */
    fallbackBetaAccepted: boolean | null;
    /** 작업별: 두 번째 이후 호출에서 cache_read_input_tokens > 0 이었는지(한 번만 돌렸으면 null) */
    cacheHit: Partial<Record<AiTask, boolean | null>>;
    /** 응답 usage 에 iterations 가 있었는지와 그 항목 종류 */
    iterationTypes: string[];
    modelsServed: string[];
  };
  report: string;
}

const sumParts = (u: ProviderUsage | undefined, k: 'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens') => (u ? u.parts.reduce((n, p) => n + p[k], 0) : null);

/** 정해 둔 예시로 작업마다 repeat 번 진짜 호출을 하고 결과를 모은다. makeClient 는 시험에서 가짜로 바꾼다. */
export async function runLiveCheck(opts: {
  settings: Record<AiTask, AiTaskSettings>;
  tasks?: readonly AiTask[];
  repeat?: number;
  makeClient?: (s: AiTaskSettings) => AnthropicLike;
  now?: () => Date;
}): Promise<LiveCheckResult> {
  const tasks = opts.tasks ?? AI_TASKS;
  const repeat = opts.repeat ?? 2;
  const now = opts.now ?? (() => new Date());
  const makeClient =
    opts.makeClient ?? ((s: AiTaskSettings) => new Anthropic({ apiKey: s.apiKey, baseURL: s.baseURL, timeout: 120_000, maxRetries: 2 }) as unknown as AnthropicLike);
  const warnings: string[] = [];
  const ledger = new LedgerStore(openDb(':memory:'), (m) => warnings.push(m));
  const day = now().toISOString().slice(0, 10);
  const calls: CallResult[] = [];

  for (const task of tasks) {
    const s = opts.settings[task];
    if (s.provider !== 'anthropic') throw new Error(`AI(${task}) 가 anthropic 이 아니에요(${s.provider}). 진짜 호출을 확인하려면 AI_PROVIDER=anthropic 으로 돌려 주세요.`);
    if (!s.apiKey) throw new Error(`AI(${task}) 에 쓸 API 키가 없어요(ANTHROPIC_API_KEY 또는 apiKeyEnv).`);
    const req = sampleRequest(task);
    for (let attempt = 1; attempt <= repeat; attempt++) {
      const raw: RawCallRecord[] = [];
      const provider = new AnthropicProvider(s, recordingClient(makeClient(s), raw), (m) => warnings.push(`AI(${task}): ${m}`));
      const started = Date.now();
      let outcome: AiOutcome = 'ok';
      let usage: ProviderUsage | undefined;
      let error: string | null = null;
      let proposals = 0;
      let dropped = 0;
      try {
        const r = await provider.propose({ request: req });
        usage = r.usage;
        const checked = toProposals(r.proposals, req.document, undefined, req.document.kind === 'tex' ? { task, instruction: req.instruction, compile: req.compile } : null);
        proposals = checked.proposals.length;
        dropped = checked.dropped;
      } catch (e) {
        outcome = e instanceof ProviderRefusedError ? 'refused' : 'failed';
        usage = e instanceof ProviderRefusedError || e instanceof ProviderFailedError ? e.usage : undefined;
        const cause = e instanceof ProviderFailedError && e.cause ? e.cause : e;
        error = (cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)).slice(0, 300);
      }
      const ms = Date.now() - started;
      const cost = ledger.recordAi({ at: now().getTime(), day, userId: 'live-check', planId: null, task, provider: 'anthropic', modelRequested: s.model, usage, docChars: req.document.paragraphs.reduce((n, p) => n + p.text.length, 0), proposals, dropped, ms, outcome });
      calls.push({
        task,
        attempt,
        outcome,
        error,
        ms,
        modelServed: usage?.modelServed ?? null,
        fallback: usage?.fallback ?? false,
        inputTokens: sumParts(usage, 'inputTokens'),
        outputTokens: sumParts(usage, 'outputTokens'),
        cacheWriteTokens: sumParts(usage, 'cacheWriteTokens'),
        cacheReadTokens: sumParts(usage, 'cacheReadTokens'),
        costMicroUsd: cost,
        proposals,
        dropped,
        raw,
      });
    }
  }

  const betaCalls = calls.filter((c) => opts.settings[c.task].fallbacks);
  const iterationTypes = new Set<string>();
  for (const c of calls)
    for (const r of c.raw) {
      const its = (r.usage as { iterations?: Array<{ type?: string }> } | null)?.iterations;
      if (Array.isArray(its)) for (const it of its) iterationTypes.add(String(it.type));
    }
  const cacheHit: Partial<Record<AiTask, boolean | null>> = {};
  for (const task of tasks) {
    const later = calls.filter((c) => c.task === task && c.attempt > 1);
    cacheHit[task] = later.length === 0 ? null : later.some((c) => (c.cacheReadTokens ?? 0) > 0);
  }
  return {
    at: now().toISOString(),
    calls,
    warnings,
    checks: {
      allOk: calls.every((c) => c.outcome === 'ok'),
      usageReported: calls.every((c) => c.inputTokens !== null),
      // 베타 옵션을 보낸 호출이 다시 보내지 않고(첫 요청이 beta.messages 로 끝남) 답을 받았는지
      fallbackBetaAccepted: betaCalls.length === 0 ? null : betaCalls.every((c) => c.raw.length > 0 && c.raw.every((r) => r.endpoint === 'beta.messages')),
      cacheHit,
      iterationTypes: [...iterationTypes].sort(),
      modelsServed: [...new Set(calls.map((c) => c.modelServed).filter((m): m is string => m !== null))].sort(),
    },
    report: buildReport(ledger, day, day).text.split('\n\n')[0] as string,
  };
}

const usd = (micro: number | null) => (micro === null ? '-' : `$${(micro / 1_000_000).toFixed(4)}`);
const yn = (v: boolean | null | undefined) => (v === null || v === undefined ? '해당 없음' : v ? '예' : '아니오');

export function formatLiveCheck(r: LiveCheckResult): string {
  const lines = [`진짜 Claude 호출 확인 ${r.at}`];
  for (const c of r.calls) {
    lines.push(
      `- ${c.task} #${c.attempt}: ${c.outcome}${c.error ? ` (${c.error})` : ''} · ${c.modelServed ?? '모델 모름'}${c.fallback ? '(대체 모델)' : ''} · 입력 ${c.inputTokens ?? '-'} / 출력 ${c.outputTokens ?? '-'} / 캐시 쓰기 ${c.cacheWriteTokens ?? '-'} / 캐시 읽기 ${c.cacheReadTokens ?? '-'} · ${usd(c.costMicroUsd)} · ${(c.ms / 1000).toFixed(1)}초 · 제안 ${c.proposals}(제외 ${c.dropped})`,
    );
  }
  const k = r.checks;
  lines.push(
    '',
    `모두 성공: ${yn(k.allOk)} · 사용량 받음: ${yn(k.usageReported)} · 대체 모델 옵션 수락: ${yn(k.fallbackBetaAccepted)}`,
    `캐시 적중(두 번째 호출부터): ${Object.entries(k.cacheHit).map(([t, v]) => `${t} ${yn(v)}`).join(' · ')}`,
    `응답한 모델: ${k.modelsServed.join(', ') || '-'} · usage.iterations 항목: ${k.iterationTypes.join(', ') || '없음'}`,
  );
  if (r.warnings.length) lines.push('경고:', ...r.warnings.map((w) => `  ${w}`));
  lines.push('', r.report);
  return lines.join('\n');
}

export function parseLiveArgs(argv: string[]): { yes: boolean; repeat: number; tasks: AiTask[]; out: string | null } {
  const get = (n: string) => {
    const i = argv.indexOf(n);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const repeat = Number(get('--repeat') ?? 2);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error('--repeat 는 1–5 의 정수여야 해요.');
  const tasks = (get('--tasks') ?? AI_TASKS.join(',')).split(',').map((t) => t.trim()) as AiTask[];
  for (const t of tasks) if (!(AI_TASKS as readonly string[]).includes(t)) throw new Error(`모르는 작업이에요: ${t} (${AI_TASKS.join(', ')})`);
  return { yes: argv.includes('--yes'), repeat, tasks, out: get('--out') ?? null };
}

// 직접 실행했을 때만 돈다(시험에서 불러올 때는 돌지 않는다).
if (process.argv[1] && /live-check\.(js|ts)$/.test(process.argv[1])) {
  const { loadDotEnv } = await import('./dotenv');
  loadDotEnv();
  const { loadConfig, ConfigError } = await import('./config');
  const { writeFileSync } = await import('node:fs');
  try {
    const args = parseLiveArgs(process.argv.slice(2));
    const config = loadConfig();
    if (!args.yes) {
      console.log(`실제 API 를 ${args.tasks.length * args.repeat}번 호출해 요금이 들어요(작업 ${args.tasks.join(', ')} × ${args.repeat}번). 돌리려면 --yes 를 붙여 주세요.`);
      process.exit(0);
    }
    const result = await runLiveCheck({ settings: config.ai, tasks: args.tasks, repeat: args.repeat });
    console.log(formatLiveCheck(result));
    if (args.out) {
      writeFileSync(args.out, JSON.stringify(result, null, 2));
      console.log(`\n결과를 ${args.out} 에 저장했어요.`);
    }
    if (!result.checks.allOk) process.exitCode = 1;
  } catch (e) {
    console.error(e instanceof ConfigError ? `설정 문제:\n  - ${e.problems.join('\n  - ')}` : e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
