import { z } from 'zod';
import { DocSummarySchema, StyleProfileSchema } from './style';
import { ProposalSchema } from './ops';
import { PlanInfoSchema } from './billing';
import { CompileInfoSchema, TexDiagnosticSchema } from './tex/api';

export { MAX_DOC_CHARS } from './limits';

/** 화면에서 고르는 AI 요청 갈래. tex_fix 는 LaTeX 컴파일 탭의 "AI로 오류 고치기" */
export const AI_MODES = ['chat', 'format_check', 'tex_fix'] as const;
export type AiMode = (typeof AI_MODES)[number];

/**
 * 서버 안의 AI 작업. 작업마다 모델·시스템 프롬프트를 따로 정할 수 있다(docs/AI.md).
 * LaTeX 프로젝트의 대화는 tex_chat, 오류 고치기는 tex_fix 로 보낸다.
 */
export const AI_TASKS = ['chat', 'format_check', 'tex_chat', 'tex_fix'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export function taskOf(req: Pick<AiRequest, 'mode' | 'document'>): AiTask {
  if (req.document.kind === 'tex') return req.mode === 'tex_fix' ? 'tex_fix' : 'tex_chat';
  return req.mode === 'tex_fix' ? 'chat' : req.mode;
}

/** 오류 고치기에 함께 보내는 컴파일 결과(진단 50개, 로그 끝 8,000자까지) */
export const CompileContextSchema = z.object({
  diagnostics: z.array(TexDiagnosticSchema).max(50),
  logExcerpt: z.string().max(8000),
});
export type CompileContext = z.infer<typeof CompileContextSchema>;

/** 서식 점검 기준: 문서 안 일관성(기본) · 기준 문서 · 내 규칙 */
export const CRITERIA = ['consistency', 'reference', 'rules'] as const;
export type Criteria = (typeof CRITERIA)[number];

export const AiRequestSchema = z.object({
  mode: z.enum(AI_MODES),
  /** 사용자가 AI 에게 시킨 말. 서식 점검에서는 비어 있을 수 있다. */
  instruction: z.string().max(4000),
  document: DocSummarySchema,
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .optional(),
  criteria: z.enum(CRITERIA).optional(),
  /** criteria === 'reference' */
  reference: StyleProfileSchema.optional(),
  /** criteria === 'rules' */
  rulesText: z.string().max(4000).optional(),
  /** mode === 'tex_fix' */
  compile: CompileContextSchema.optional(),
});
export type AiRequest = z.infer<typeof AiRequestSchema>;

export const QuotaSchema = z.object({
  limit: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
});
export type Quota = z.infer<typeof QuotaSchema>;

export const AiResponseSchema = z.object({
  reply: z.string(),
  proposals: z.array(ProposalSchema),
  /** 실제 AI 가 아닌 데모(mock) 응답이면 true */
  demo: z.boolean(),
  quota: QuotaSchema.nullable(),
});
export type AiResponse = z.infer<typeof AiResponseSchema>;

export const AUTH_MODES = ['google', 'dev', 'none'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export const MeResponseSchema = z.object({
  authMode: z.enum(AUTH_MODES),
  authenticated: z.boolean(),
  user: z.object({ name: z.string().nullable(), email: z.string().nullable(), picture: z.string().nullable() }).nullable(),
  /** 오늘 남은 횟수(하루 한도가 없는 요금제·로그인 전이면 null) */
  quota: QuotaSchema.nullable(),
  /** 로그인한 사용자의 요금제와 이번 달 사용 횟수(로그인 전이면 null) */
  plan: PlanInfoSchema.nullable(),
  usage: z.object({ aiToday: z.number().int(), aiThisMonth: z.number().int() }).nullable(),
  ai: z.object({ available: z.boolean(), demo: z.boolean(), provider: z.string() }),
  /** 이 사용자가 한 번에 보낼 수 있는 문서 글자 수(요금제마다 다름) */
  maxDocChars: z.number().int(),
  /** 약관 동의. 서버에 약관 판(TERMS_VERSION)이 없으면 null. required 는 로그인한 사용자가 이 판에 아직 동의하지 않았는지 */
  agreement: z
    .object({ required: z.boolean(), version: z.string(), termsUrl: z.string().nullable(), privacyUrl: z.string().nullable() })
    .nullable(),
  /** LaTeX 컴파일. 서버에 컴파일이 연결되어 있지 않으면 null */
  compile: CompileInfoSchema.nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const AgreeRequestSchema = z.object({ version: z.string(), age14: z.literal(true) });
export type AgreeRequest = z.infer<typeof AgreeRequestSchema>;

/** 계정 삭제 요청에 함께 보내야 하는 확인 문구(실수로 지우지 않도록) */
export const ACCOUNT_DELETE_CONFIRM = '계정 삭제';

/** 서버가 돌려주는 오류 형식. message 는 사용자에게 그대로 보여줘도 되는 한국어 문장이다. */
export const ErrorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ERROR_CODES = {
  unauthenticated: 'unauthenticated',
  quotaExceeded: 'quota_exceeded',
  badRequest: 'bad_request',
  tooLarge: 'document_too_large',
  aiUnavailable: 'ai_unavailable',
  aiRefused: 'ai_refused',
  aiFailed: 'ai_failed',
  /** 같은 사용자의 AI 요청이 아직 처리 중일 때 */
  busy: 'busy',
  forbidden: 'forbidden',
  /** 약관(새 판)에 동의해야 쓸 수 있는 기능 */
  agreementRequired: 'agreement_required',
  /** 이 서버에 LaTeX 컴파일이 연결되어 있지 않음 */
  compileUnavailable: 'compile_unavailable',
  /** 컴파일 요청의 파일 중 서버에 없는(이 사용자가 올리지 않은) 것이 있음. 응답의 missing 에 해시 목록 */
  blobsMissing: 'blobs_missing',
  /** 컴파일 일꾼 연결·응답 문제 */
  compileFailed: 'compile_failed',
  internal: 'internal',
} as const;
