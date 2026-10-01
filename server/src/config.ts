// 환경 변수와 AI 설정 파일을 읽어 한 번 검증한다. 잘못된 설정은 서버를 켤 때 바로 알려 준다(나중에 요청 중에 터지지 않도록).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AUTH_MODES, type AiMode, type AuthMode } from '@alldoc/shared';
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

/** 작업 하나(AI 대화, 서식 점검)를 처리할 AI 연결의 최종 설정 */
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
}

export interface Config {
  port: number;
  publicUrl: string;
  secureCookies: boolean;
  production: boolean;
  sessionSecret: string;
  authMode: AuthMode;
  google: { clientId: string; clientSecret: string } | null;
  dailyLimit: number;
  timezone: string;
  dataDir: string;
  webDist: string;
  allowedOrigins: string[];
  ai: Record<AiMode, AiTaskSettings>;
}

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
  DATA_DIR: z.string().default('./data'),
  WEB_DIST: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
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
  })
  .strict();

export const AiConfigFileSchema = z
  .object({
    default: TaskFileSchema.optional(),
    tasks: z.object({ chat: TaskFileSchema.optional(), format_check: TaskFileSchema.optional() }).strict().optional(),
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

  const ai = {} as Record<AiMode, AiTaskSettings>;
  for (const mode of ['chat', 'format_check'] as const) {
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
    };
  }

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
    dailyLimit: env.DAILY_AI_LIMIT,
    timezone: env.APP_TIMEZONE,
    dataDir: resolve(env.DATA_DIR),
    webDist: resolve(env.WEB_DIST ?? resolve(deps.moduleDir, '../../web/dist')),
    allowedOrigins: [...origins],
    ai,
  };
}
