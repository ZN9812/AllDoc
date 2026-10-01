/** 서버가 알려주는 AI 연결 이름을 화면에 보여줄 이름으로 바꾼다. */
const NAMES: Record<string, string> = {
  anthropic: 'Anthropic(Claude)',
  mock: '데모 AI(실제 AI가 아닙니다)',
};

export function providerName(provider: string | undefined): string {
  return (provider && NAMES[provider]) || '외부 AI 서비스';
}
