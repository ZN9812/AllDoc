import { z } from 'zod';
import { DocSummarySchema, StyleProfileSchema } from './style';
import { ProposalSchema } from './ops';

/** AI 요청 한 번에 보낼 수 있는 문서 글자 수 상한(넘으면 범위를 줄여 달라고 안내한다) */
export const MAX_DOC_CHARS = 120_000;

export const AI_MODES = ['chat', 'format_check'] as const;
export type AiMode = (typeof AI_MODES)[number];

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
  quota: QuotaSchema.nullable(),
  ai: z.object({ available: z.boolean(), demo: z.boolean(), provider: z.string() }),
  maxDocChars: z.number().int(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

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
  internal: 'internal',
} as const;
