// 한국어 조사 고르기: 앞 낱말의 마지막 글자에 받침이 있는지에 따라 은/는, 이/가, 을/를, (으)로 를 맞춘다.
// 숫자는 읽는 소리(영·일·이·삼·사·오·육·칠·팔·구)를 기준으로 하고, 영문 등 그 밖의 글자는 받침이 없다고 본다.

function lastChar(word: string): string {
  const chars = [...word.trim()];
  // 끝의 괄호·마침표 같은 기호는 건너뛰고 읽을 수 있는 마지막 글자를 찾는다.
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i] as string;
    if (/[0-9A-Za-z가-힣]/.test(ch)) return ch;
  }
  return '';
}

/** 숫자를 읽는 소리의 받침: 영(ㅇ) 일(ㄹ) 이 삼(ㅁ) 사 오 육(ㄱ) 칠(ㄹ) 팔(ㄹ) 구 */
const DIGIT_TAIL: Record<string, 0 | 1 | 2> = { '0': 2, '1': 1, '2': 0, '3': 2, '4': 0, '5': 0, '6': 2, '7': 1, '8': 1, '9': 0 };

/** 받침 종류: 0 = 받침 없음, 1 = ㄹ 받침, 2 = 그 밖의 받침 */
function batchim(word: string): 0 | 1 | 2 {
  const ch = lastChar(word);
  if (ch === '') return 0;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const tail = (code - 0xac00) % 28;
    return tail === 0 ? 0 : tail === 8 ? 1 : 2;
  }
  if (/[0-9]/.test(ch)) return DIGIT_TAIL[ch] ?? 0;
  return 0;
}

export const eunNeun = (word: string): string => `${word}${batchim(word) === 0 ? '는' : '은'}`;
export const iGa = (word: string): string => `${word}${batchim(word) === 0 ? '가' : '이'}`;
export const eulReul = (word: string): string => `${word}${batchim(word) === 0 ? '를' : '을'}`;
/** (으)로: 받침이 없거나 ㄹ 받침이면 "로", 그 밖의 받침이면 "으로" */
export const euro = (word: string): string => `${word}${batchim(word) === 2 ? '으로' : '로'}`;
