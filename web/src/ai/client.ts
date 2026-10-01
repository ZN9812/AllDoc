// 서버(/api)와 대화하는 부분. AI 키는 서버에만 있고, 브라우저는 우리 서버에만 요청한다.
import {
  AiResponseSchema,
  ErrorResponseSchema,
  MeResponseSchema,
  type AiRequest,
  type AiResponse,
  type MeResponse,
} from '@alldoc/shared';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function genericMessage(status: number): string {
  if (status === 0) return '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.';
  if (status === 401) return '로그인이 필요해요.';
  if (status === 429) return '오늘 쓸 수 있는 AI 횟수를 모두 사용했어요.';
  if (status >= 500) return '서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요.';
  return '요청을 처리하지 못했어요.';
}

async function request<T>(path: string, init: RequestInit, schema: ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiError(0, 'network', genericMessage(0));
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // JSON 이 아닌 응답은 아래에서 일반 오류로 처리한다.
  }

  if (!res.ok) {
    const parsed = ErrorResponseSchema.safeParse(body);
    if (parsed.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message);
    throw new ApiError(res.status, 'http_error', genericMessage(res.status));
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(res.status, 'bad_response', '서버 응답을 이해하지 못했어요.');
  return parsed.data;
}

export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return request('/api/me', { signal }, MeResponseSchema);
}

export function postPropose(body: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
  return request(
    '/api/ai/propose',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal },
    AiResponseSchema,
  );
}

export async function postLogout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
}

export function loginUrl(next: string): string {
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
}
