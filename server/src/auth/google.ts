// 구글 로그인(인가 코드 + PKCE). 코드 교환은 서버가 구글과 직접(HTTPS) 하므로, 받은 사용자 정보는 별도의 토큰 서명 검증 없이 믿어도 된다.
import type { SessionUser } from './session';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export function buildAuthUrl(client: GoogleClient, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export class GoogleLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleLoginError';
  }
}

export async function loginWithCode(
  client: GoogleClient,
  redirectUri: string,
  code: string,
  verifier: string,
  fetchFn: typeof fetch = fetch,
): Promise<SessionUser> {
  const tokenRes = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new GoogleLoginError(`토큰 교환 실패(${tokenRes.status})`);
  const token = (await tokenRes.json()) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') throw new GoogleLoginError('액세스 토큰이 없어요.');

  const infoRes = await fetchFn(USERINFO_URL, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!infoRes.ok) throw new GoogleLoginError(`사용자 정보 조회 실패(${infoRes.status})`);
  const info = (await infoRes.json()) as { sub?: unknown; name?: unknown; email?: unknown };
  if (typeof info.sub !== 'string' || info.sub.length === 0) throw new GoogleLoginError('사용자 식별자가 없어요.');
  return {
    id: `g:${info.sub}`,
    name: typeof info.name === 'string' ? info.name : null,
    email: typeof info.email === 'string' ? info.email : null,
  };
}
