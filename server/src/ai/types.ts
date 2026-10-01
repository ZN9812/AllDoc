import type { AiRequest } from '@alldoc/shared';
import type { RawProposal } from './schema';

export interface ProposeInput {
  request: AiRequest;
  signal?: AbortSignal;
}

/** 연결부가 돌려주는 값. 아직 검증 전이다(서버가 문서와 대조해 걸러낸 뒤 화면에 보낸다). */
export interface ProviderResult {
  reply: string;
  proposals: RawProposal[];
}

/**
 * AI 연결부. Claude 외의 모델(예: Gemini, 직접 학습시킨 모델)을 붙이려면 이 약속만 지키면 된다.
 * 연결부는 ProviderRefusedError / ProviderFailedError 로 실패를 알린다.
 */
export interface AiProvider {
  readonly id: string;
  /** 실제 AI 가 아닌 예시 응답이면 true(화면에 "데모" 안내를 띄운다) */
  readonly demo: boolean;
  propose(input: ProposeInput): Promise<ProviderResult>;
}

/** 모델이 정책상 답하기를 거절했다. 요청은 처리됐으므로 사용 횟수는 돌려주지 않는다. */
export class ProviderRefusedError extends Error {
  constructor(message = 'AI가 이 요청에는 답할 수 없다고 했어요.') {
    super(message);
    this.name = 'ProviderRefusedError';
  }
}

/** 연결 실패, 한도 초과, 응답 이해 실패 등. 사용 횟수를 돌려준다. */
export class ProviderFailedError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProviderFailedError';
  }
}
