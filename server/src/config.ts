// 환경 변수와 AI 설정 파일을 읽어 한 번 검증한다. 잘못된 설정은 서버를 켤 때 바로 알려 준다(나중에 요청 중에 터지지 않도록).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AI_TASKS, AUTH_MODES, DEFAULT_COMPILE_LIMITS, MAX_DOC_CHARS, PlanSchema, type AiTask, type AuthMode, type Plan } from '@alldoc/shared';
import { buildSystemPrompt } from './ai/prompt';

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'ConfigError';
  }
}

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const PROVIDER_IDS = ['anthropic', 'mock', 'off'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** 작업 하나(AI 대화, 서식 점검, LaTeX 대화, LaTeX 오류 고치기)를 처리할 AI 연결의 최종 설정 */
export interface AiTaskSettings {
  provider: ProviderId;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** 다른 곳에 둔 Claude 호환 주소를 쓸 때만 */
  baseURL: string | undefined;
  apiKey: string | undefined;
  systemPrompt: string;
  /** 모델이 정책상 답을 거절하면 서버가 대체 모델로 한 번 더 시도하게 하는 Anthropic 옵션 */
  fallbacks: boolean;
  /** 프롬프트 캐싱 범위: off(안 함) · system(시스템 프롬프트, 기본) · document(시스템 프롬프트 + 문서) */
  promptCache: PromptCacheMode;
}

export const PROMPT_CACHE_MODES = ['off', 'system', 'document'] as const;
export type PromptCacheMode = (typeof PROMPT_CACHE_MODES)[number];

export interface Config {
  port: number;
  publicUrl: string;
  secureCookies: boolean;
  production: boolean;
  sessionSecret: string;
  authMode: AuthMode;
  google: { clientId: string; clientSecret: string } | null;
  timezone: string;
  dataDir: string;
  /** 하루 한 번 스냅숏을 둘 폴더(기본 DATA_DIR/backups)와 남길 개수(0 이면 백업하지 않음) */
  backup: { dir: string; keep: number };
  webDist: string;
  allowedOrigins: string[];
  /** 작업별 AI 설정(chat·format_check·tex_chat·tex_fix) */
  ai: Record<AiTask, AiTaskSettings>;
  /** 요금제 목록과 기본 요금제. PLANS_CONFIG_PATH 가 없으면 DAILY_AI_LIMIT 로 만든 free 하나 */
  plans: { defaultPlanId: string; list: Plan[] };
  /** 전체 하루 AI 원가 상한(마이크로달러). 넘으면 그날은 AI 를 멈춘다(503). null 이면 없음 */
  aiDailyBudgetMicroUsd: number | null;
  /** 동의를 받아야 하는 약관 판과 전문 주소. null 이면 동의를 받지 않는다(자체 설치 기본) */
  terms: { version: string; termsUrl: string; privacyUrl: string } | null;
  /** LaTeX 컴파일. null 이면 끔(COMPILER=off, 기본) */
  compiler: CompilerSettings | null;
  /** 비공개 베타: 초대받은 사람만 로그인·가입(BETA_MODE=invite). 기본 꺼짐 */
  beta: boolean;
  /** 하단에 보여 줄 사업자 정보와 문의 창구, 정책 문서 폴더(GET /api/site) */
  site: SiteSettings;
}

export interface SiteSettings {
  /** 비어 있는 항목은 보여 주지 않는다. 모두 비면 null */
  business: BusinessInfo | null;
  contact: { email: string | null; url: string | null } | null;
  /** 이용약관·개인정보처리방침·환불정책 md 파일을 둔 폴더(POLICY_DIR). null 이면 모두 "준비 중" */
  policyDir: string | null;
}

/** 전자상거래법 등에 따라 하단에 적는 값. 서버는 값을 확인하지 않고 운영자가 넣은 그대로 보여 준다. */
export interface BusinessInfo {
  name: string | null;
  owner: string | null;
  registrationNo: string | null;
  mailOrderNo: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  privacyOfficer: string | null;
  hosting: string | null;
}

/** 사업자 정보 환경 변수와 화면 항목의 짝 */
export const BUSINESS_ENV = {
  name: 'BUSINESS_NAME',
  owner: 'BUSINESS_OWNER',
  registrationNo: 'BUSINESS_REG_NO',
  mailOrderNo: 'BUSINESS_MAIL_ORDER_NO',
  address: 'BUSINESS_ADDRESS',
  phone: 'BUSINESS_PHONE',
  email: 'BUSINESS_EMAIL',
  privacyOfficer: 'BUSINESS_PRIVACY_OFFICER',
  hosting: 'BUSINESS_HOSTING',
} as const satisfies Record<keyof BusinessInfo, string>;

export const BETA_MODES = ['off', 'invite'] as const;

export const COMPILER_MODES = ['off', 'mock', 'http'] as const;

export interface CompilerSettings {
  mode: 'mock' | 'http';
  /** http: 일꾼 주소 목록(COMPILER_URLS, 쉼표로 구분) */
  urls: string[];
  /** http: 요청 서명 비밀값(COMPILER_SECRET, 32자 이상) */
  secret: string;
  /** 동시에 돌리는 컴파일 수(서버 전체) */
  concurrency: number;
  /** 기다릴 수 있는 컴파일 수(서버 전체). 넘으면 503 busy */
  queue: number;
  /** 올린 파일을 마지막 사용 뒤 며칠 두는지 */
  retentionDays: number;
}

export const PlansFileSchema = z
  .object({
    /** 로그인한 사용자가 기본으로 받는 요금제 id */
    default: z.string(),
    plans: z.array(PlanSchema).min(1),
  })
  .strict();

const blank = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : v.trim());

const EnvSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  PUBLIC_URL: z.url().default('http://localhost:8787'),
  SESSION_SECRET: z.string().optional(),
  AUTH_MODE: z.enum(AUTH_MODES).default('google'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  DAILY_AI_LIMIT: z.coerce.number().int().min(1).max(100_000).default(5),
  APP_TIMEZONE: z.string().default('Asia/Seoul'),
  AI_PROVIDER: z.enum(PROVIDER_IDS).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_CONFIG_PATH: z.string().optional(),
  PLANS_CONFIG_PATH: z.string().optional(),
  AI_DAILY_BUDGET_USD: z.coerce.number().positive().optional(),
  TERMS_VERSION: z.string().max(40).optional(),
  TERMS_URL: z.url().optional(),
  PRIVACY_URL: z.url().optional(),
  DATA_DIR: z.string().default('./data'),
  BACKUP_DIR: z.string().optional(),
  BACKUP_KEEP: z.coerce.number().int().min(0).max(3650).default(14),
  WEB_DIST: z.string().optional(),
  COMPILER: z.enum(COMPILER_MODES).default('off'),
  COMPILER_URLS: z.string().optional(),
  COMPILER_SECRET: z.string().optional(),
  COMPILER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  COMPILER_QUEUE: z.coerce.number().int().min(0).max(1000).default(10),
  TEX_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  ALLOWED_ORIGINS: z.string().optional(),
  BETA_MODE: z.enum(BETA_MODES).default('off'),
  CONTACT_EMAIL: z.email().optional(),
  CONTACT_URL: z.url().optional(),
  POLICY_DIR: z.string().optional(),
  BUSINESS_NAME: z.string().max(200).optional(),
  BUSINESS_OWNER: z.string().max(200).optional(),
  BUSINESS_REG_NO: z.string().max(200).optional(),
  BUSINESS_MAIL_ORDER_NO: z.string().max(200).optional(),
  BUSINESS_ADDRESS: z.string().max(200).optional(),
  BUSINESS_PHONE: z.string().max(200).optional(),
  BUSINESS_EMAIL: z.string().max(200).optional(),
  BUSINESS_PRIVACY_OFFICER: z.string().max(200).optional(),
  BUSINESS_HOSTING: z.string().max(200).optional(),
});

const TaskFileSchema = z
  .object({
    provider: z.enum(PROVIDER_IDS).optional(),
    model: z.string().min(1).optional(),
    effort: z.enum(EFFORTS).optional(),
    maxTokens: z.number().int().min(256).max(20_000).optional(),
    baseURL: z.url().optional(),
    /** 이 작업에 쓸 API 키가 들어 있는 환경 변수 이름(키 값 자체를 파일에 적지 않는다) */
    apiKeyEnv: z.string().min(1).optional(),
    /** 기본 시스템 프롬프트를 통째로 바꾼다 */
    systemPrompt: z.string().min(1).optional(),
    /** 위와 같지만 파일에서 읽는다(설정 파일 기준 상대 경로) */
    systemPromptFile: z.string().min(1).optional(),
    /** 기본 시스템 프롬프트 뒤에 규칙을 덧붙인다 */
    systemPromptAppend: z.string().min(1).optional(),
    fallbacks: z.enum(['default', 'off']).optional(),
    promptCache: z.enum(PROMPT_CACHE_MODES).optional(),
  })
  .strict();

export const AiConfigFileSchema = z
  .object({
    default: TaskFileSchema.optional(),
    tasks: z
      .object({ chat: TaskFileSchema.optional(), format_check: TaskFileSchema.optional(), tex_chat: TaskFileSchema.optional(), tex_fix: TaskFileSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();
export type AiConfigFile = z.infer<typeof AiConfigFileSchema>;

export interface LoadDeps {
  env: Record<string, string | undefined>;
  readFile: (path: string) => string;
  /** 서버 파일이 놓인 위치(정적 파일 기본 경로 계산용) */
  moduleDir: string;
  randomSecret: () => string;
}

const defaultDeps = (): LoadDeps => ({
  env: process.env,
  readFile: (p) => readFileSync(p, 'utf8'),
  moduleDir: dirname(fileURLToPath(import.meta.url)),
  randomSecret: () => randomBytes(32).toString('hex'),
});

function issues(prefix: string, err: z.ZodError): string[] {
  return err.issues.map((i) => `${prefix}${i.path.length > 0 ? ` ${i.path.join('.')}` : ''}: ${i.message}`);
}

export function loadConfig(overrides: Partial<LoadDeps> = {}): Config {
  const deps = { ...defaultDeps(), ...overrides };
  const problems: string[] = [];

  const rawEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(EnvSchema.shape)) rawEnv[key] = blank(deps.env[key]);
  const parsed = EnvSchema.safeParse(rawEnv);
  if (!parsed.success) throw new ConfigError(issues('환경 변수', parsed.error));
  const env = parsed.data;

  const production = env.NODE_ENV === 'production';
  const publicUrl = env.PUBLIC_URL.replace(/\/+$/, '');

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE });
  } catch {
    problems.push(`APP_TIMEZONE: "${env.APP_TIMEZONE}" 은(는) 올바른 시간대가 아니에요. 예: Asia/Seoul`);
  }

  if (env.AUTH_MODE === 'dev' && production) {
    problems.push('AUTH_MODE=dev 는 개발용 가짜 로그인이라 운영(NODE_ENV=production)에서는 쓸 수 없어요. google 로 바꿔 주세요.');
  }
  if (env.AUTH_MODE === 'none' && production) {
    console.warn('경고: AUTH_MODE=none 은 누구나 로그인 없이 AI를 쓰고 하루 한도도 없어요. 신뢰할 수 있는 내부망에서만 쓰세요.');
  }

  let google: Config['google'] = null;
  if (env.AUTH_MODE === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      problems.push('AUTH_MODE=google 에는 GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 이 필요해요. (개발 중이라면 AUTH_MODE=dev 로 실행해 보세요.)');
    } else {
      google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
    }
  }

  let sessionSecret = env.SESSION_SECRET;
  if (env.AUTH_MODE !== 'none') {
    if (!sessionSecret) {
      if (production) problems.push('SESSION_SECRET 이 필요해요. 32자 이상 무작위 문자열을 넣어 주세요. (예: openssl rand -hex 32)');
      else {
        sessionSecret = deps.randomSecret();
        console.warn('SESSION_SECRET 이 없어 임시 값을 만들었어요. 서버를 다시 켜면 로그인이 풀려요.');
      }
    } else if (sessionSecret.length < 32) {
      problems.push('SESSION_SECRET 은 32자 이상이어야 해요.');
    }
  }

  // AI 설정 파일
  let file: AiConfigFile = {};
  const configPath = blank(deps.env.AI_CONFIG_PATH);
  let configDir = deps.moduleDir;
  if (configPath) {
    const abs = resolve(configPath);
    configDir = dirname(abs);
    try {
      const json: unknown = JSON.parse(deps.readFile(abs));
      const r = AiConfigFileSchema.safeParse(json);
      if (r.success) file = r.data;
      else problems.push(...issues(`AI 설정 파일(${configPath})`, r.error));
    } catch (e) {
      problems.push(`AI 설정 파일(${configPath})을 읽지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const ai = {} as Record<AiTask, AiTaskSettings>;
  for (const mode of AI_TASKS) {
    const merged = { ...file.default, ...file.tasks?.[mode] };
    const label = `AI 설정(${mode})`;
    if (merged.systemPrompt && merged.systemPromptFile) problems.push(`${label}: systemPrompt 와 systemPromptFile 은 함께 쓸 수 없어요.`);

    let base = buildSystemPrompt(mode);
    if (merged.systemPrompt) base = merged.systemPrompt;
    else if (merged.systemPromptFile) {
      try {
        base = deps.readFile(resolve(configDir, merged.systemPromptFile));
      } catch (e) {
        problems.push(`${label}: 시스템 프롬프트 파일을 읽지 못했어요(${merged.systemPromptFile}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (merged.systemPromptAppend) base = `${base}\n\n${merged.systemPromptAppend}`;

    const provider = merged.provider ?? env.AI_PROVIDER;
    const keyEnv = merged.apiKeyEnv;
    const apiKey = keyEnv ? blank(deps.env[keyEnv]) : env.ANTHROPIC_API_KEY;
    if (keyEnv && !apiKey && provider === 'anthropic') problems.push(`${label}: apiKeyEnv 로 지정한 환경 변수 ${keyEnv} 가 비어 있어요.`);

    ai[mode] = {
      provider,
      model: merged.model ?? DEFAULT_MODEL,
      effort: merged.effort ?? 'medium',
      maxTokens: merged.maxTokens ?? 16_000,
      baseURL: merged.baseURL,
      apiKey,
      systemPrompt: base,
      fallbacks: (merged.fallbacks ?? 'default') === 'default',
      promptCache: merged.promptCache ?? 'system',
    };
  }

  if (env.TERMS_VERSION && (!env.TERMS_URL || !env.PRIVACY_URL)) {
    problems.push('TERMS_VERSION 을 쓰면 동의 화면에 보여 줄 TERMS_URL(이용약관)과 PRIVACY_URL(개인정보처리방침)도 넣어 주세요.');
  }

  // 요금제 파일
  let plans: Config['plans'] = {
    defaultPlanId: 'free',
    list: [{ id: 'free', name: '무료', limits: { aiRequestsPerDay: env.DAILY_AI_LIMIT, aiRequestsPerMonth: null, aiMaxDocChars: MAX_DOC_CHARS, aiCostCapMicroUsdPerMonth: null, ...DEFAULT_COMPILE_LIMITS } }],
  };
  if (env.PLANS_CONFIG_PATH) {
    try {
      const r = PlansFileSchema.safeParse(JSON.parse(deps.readFile(resolve(env.PLANS_CONFIG_PATH))));
      if (!r.success) problems.push(...issues(`요금제 파일(${env.PLANS_CONFIG_PATH})`, r.error));
      else {
        const ids = r.data.plans.map((p) => p.id);
        if (new Set(ids).size !== ids.length) problems.push(`요금제 파일(${env.PLANS_CONFIG_PATH}): 요금제 id 가 겹쳐요.`);
        if (!ids.includes(r.data.default)) problems.push(`요금제 파일(${env.PLANS_CONFIG_PATH}): 기본 요금제 "${r.data.default}" 가 plans 에 없어요.`);
        plans = { defaultPlanId: r.data.default, list: r.data.plans };
      }
    } catch (e) {
      problems.push(`요금제 파일(${env.PLANS_CONFIG_PATH})을 읽지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // LaTeX 컴파일
  let compiler: Config['compiler'] = null;
  if (env.COMPILER !== 'off') {
    const urls = (env.COMPILER_URLS ?? '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (env.COMPILER === 'http') {
      if (urls.length === 0) problems.push('COMPILER=http 에는 컴파일 일꾼 주소 COMPILER_URLS 가 필요해요. 예: http://compiler:8790');
      for (const u of urls) {
        try {
          new URL(u);
        } catch {
          problems.push(`COMPILER_URLS: "${u}" 은(는) 올바른 주소가 아니에요.`);
        }
      }
      if (!env.COMPILER_SECRET || env.COMPILER_SECRET.length < 32) problems.push('COMPILER=http 에는 32자 이상의 COMPILER_SECRET 이 필요해요(일꾼과 같은 값).');
    } else if (production) {
      console.warn('경고: COMPILER=mock 은 실제 TeX 가 아닌 데모 컴파일러예요.');
    }
    compiler = {
      mode: env.COMPILER,
      urls,
      secret: env.COMPILER_SECRET ?? '',
      concurrency: env.COMPILER_CONCURRENCY,
      queue: env.COMPILER_QUEUE,
      retentionDays: env.TEX_RETENTION_DAYS,
    };
  }

  if (env.BETA_MODE === 'invite' && env.AUTH_MODE === 'none') {
    problems.push('BETA_MODE=invite 는 로그인이 있어야 해요. AUTH_MODE=none 과 함께 쓸 수 없어요.');
  }
  if (env.CONTACT_URL && !/^https?:\/\//.test(env.CONTACT_URL)) problems.push('CONTACT_URL 은 http:// 또는 https:// 주소여야 해요.');

  const businessEntries = Object.entries(BUSINESS_ENV).map(([field, key]) => [field, env[key] ?? null] as const);
  const business = businessEntries.some(([, v]) => v !== null) ? (Object.fromEntries(businessEntries) as unknown as BusinessInfo) : null;
  const contact = env.CONTACT_EMAIL || env.CONTACT_URL ? { email: env.CONTACT_EMAIL ?? null, url: env.CONTACT_URL ?? null } : null;

  if (problems.length > 0) throw new ConfigError(problems);

  const origins = new Set<string>([new URL(publicUrl).origin]);
  for (const o of (env.ALLOWED_ORIGINS ?? '').split(',')) {
    if (!blank(o)) continue;
    try {
      origins.add(new URL(o.trim()).origin);
    } catch {
      throw new ConfigError([`ALLOWED_ORIGINS: "${o.trim()}" 은(는) 올바른 주소가 아니에요. 예: https://example.com`]);
    }
  }
  // 개발 중 Vite(5173)가 /api 를 서버로 넘겨 줄 때 브라우저가 보내는 출처
  if (!production) origins.add('http://localhost:5173');

  return {
    port: env.PORT,
    publicUrl,
    secureCookies: publicUrl.startsWith('https://'),
    production,
    sessionSecret: sessionSecret ?? '',
    authMode: env.AUTH_MODE,
    google,
    timezone: env.APP_TIMEZONE,
    dataDir: resolve(env.DATA_DIR),
    backup: { dir: resolve(env.BACKUP_DIR ?? resolve(env.DATA_DIR, 'backups')), keep: env.BACKUP_KEEP },
    webDist: resolve(env.WEB_DIST ?? resolve(deps.moduleDir, '../../web/dist')),
    allowedOrigins: [...origins],
    ai,
    plans,
    aiDailyBudgetMicroUsd: env.AI_DAILY_BUDGET_USD ? Math.round(env.AI_DAILY_BUDGET_USD * 1_000_000) : null,
    terms: env.TERMS_VERSION && env.TERMS_URL && env.PRIVACY_URL ? { version: env.TERMS_VERSION, termsUrl: env.TERMS_URL, privacyUrl: env.PRIVACY_URL } : null,
    compiler,
    beta: env.BETA_MODE === 'invite',
    site: { business, contact, policyDir: env.POLICY_DIR ? resolve(env.POLICY_DIR) : null },
  };
}
