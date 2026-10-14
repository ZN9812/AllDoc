// LaTeX 컴파일 API 의 요청·응답 형식(웹·서버 공용). 경로는 docs/LATEX.md "API".
import { z } from 'zod';
import { MAX_TEX_FILES, normalizeProjectPath } from './paths';

export const TEX_ENGINES = ['xelatex', 'pdflatex', 'lualatex'] as const;
export type TexEngine = (typeof TEX_ENGINES)[number];

export const TEX_ENGINE_LABEL: Record<TexEngine, string> = {
  xelatex: 'XeLaTeX',
  pdflatex: 'pdfLaTeX',
  lualatex: 'LuaLaTeX',
};

export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 프로젝트 안 상대 경로(normalizeProjectPath 를 거친 그대로여야 한다) */
export const ProjectPathSchema = z.string().refine((p) => normalizeProjectPath(p) === p, '쓸 수 없는 파일 경로예요.');

export const CompileFileSchema = z.object({
  path: ProjectPathSchema,
  hash: z.string().regex(SHA256_HEX),
  size: z.number().int().min(0),
});
export type CompileFile = z.infer<typeof CompileFileSchema>;

export const CompileRequestSchema = z.object({
  engine: z.enum(TEX_ENGINES),
  /** 주 파일(.tex) */
  main: ProjectPathSchema,
  files: z.array(CompileFileSchema).min(1).max(MAX_TEX_FILES),
});
export type CompileRequest = z.infer<typeof CompileRequestSchema>;

export const BlobCheckRequestSchema = z.object({ hashes: z.array(z.string().regex(SHA256_HEX)).max(MAX_TEX_FILES) });
export const BlobCheckResponseSchema = z.object({ missing: z.array(z.string()) });
export type BlobCheckResponse = z.infer<typeof BlobCheckResponseSchema>;

export const TexDiagnosticSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  message: z.string(),
});

/** ok: PDF를 만듦 · error: TeX 오류로 PDF 없음 · timeout: 시간 제한 · too_large: PDF·로그가 상한을 넘음 · failed: 일꾼 문제 */
export const COMPILE_STATUSES = ['ok', 'error', 'timeout', 'too_large', 'failed'] as const;
export type CompileStatus = (typeof COMPILE_STATUSES)[number];

export const CompileResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(COMPILE_STATUSES),
  diagnostics: z.array(TexDiagnosticSchema),
  /** 로그 끝부분(원본 로그 보기용) */
  logTail: z.string(),
  /** PDF를 받을 주소(본인만). PDF가 없으면 null */
  pdfUrl: z.string().nullable(),
  /** 서버에서 잰 시간(밀리초) */
  ms: z.number().int(),
  /** 같은 파일·엔진으로 이미 만든 결과를 다시 돌려준 것인지 */
  cached: z.boolean(),
});
export type CompileResponse = z.infer<typeof CompileResponseSchema>;

/** /api/me 의 컴파일 정보. 컴파일 서버가 없으면 me.compile 은 null */
export const CompileInfoSchema = z.object({
  /** 데모(가짜) 컴파일러인지(COMPILER=mock) */
  demo: z.boolean(),
  /** 컴파일하려고 올린 파일을 서버가 지우기까지의 날 수(마지막 사용 기준) */
  retentionDays: z.number().int(),
  timeoutSec: z.number().int(),
  projectMaxBytes: z.number().int(),
  compilesPerDay: z.number().int().nullable(),
  compilesToday: z.number().int().nullable(),
});
export type CompileInfo = z.infer<typeof CompileInfoSchema>;
