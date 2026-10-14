// LaTeX 블록을 고치는 AI 제안의 서버 검증(docs/LATEX.md "변경과 서버 검증"). 서버(convert.ts)가 부르고, 시험은 규칙마다 따로 있다.
// 제안을 클라이언트와 똑같이(첫 indexOf) 블록에 적용해 보고 앞뒤를 비교한다.
//   엄격 모드(tex_chat): 아래 규칙 중 하나라도 바뀌면 버린다.
//   느슨한 모드(tex_fix): 오류 고치기. 진단된 줄 근처와 서문만, 빈 줄 수 유지, 중괄호 짝이 나빠지지 않을 것. 진짜 확인은 다음 컴파일.
import { blankLineCount, seqOf, stripComment, type TexBlockRole } from './chunk';

export const TEX_RULES = ['role', 'blanks', 'braces', 'envs', 'keys', 'math', 'commands', 'specials', 'near'] as const;
export type TexRule = (typeof TEX_RULES)[number];

export const TEX_RULE_LABEL: Record<TexRule, string> = {
  role: '고칠 수 없는 블록(주석·verbatim·서문)',
  blanks: '빈 줄 수',
  braces: '중괄호 짝',
  envs: '\\begin/\\end 순서',
  keys: '라벨·참조·인용 키',
  math: '수식',
  commands: '명령',
  specials: '% & # _ ^ 특수 문자',
  near: '오류 근처가 아님',
};

/** 이 명령들은 넣거나 빼도 된다(글 다듬기에 흔히 쓰는 것) */
export const ALLOWED_COMMANDS = new Set(['emph', 'textit', 'textbf', 'textsc', 'underline', 'ldots', 'dots', 'enquote', 'mbox', 'footnote', 'textrm', 'textsf', 'texttt']);

const KEY_COMMANDS = /\\(label|ref|eqref|autoref|cref|Cref|pageref|nameref|vref|(?:[a-zA-Z]*cite[a-zA-Z]*)|nocite)\*?(?:\s*\[[^\]]*\])*\s*\{([^}]*)\}/g;
const MATH_ENV_NAMES = 'equation|align|gather|multline|eqnarray|displaymath|math|flalign|alignat';

/** 블록 글에 replaceText 를 클라이언트와 똑같이(첫 위치에서 한 번) 적용한다. find 가 없으면 null */
export function applyFirst(text: string, find: string, replace: string): string | null {
  const at = text.indexOf(find);
  return at < 0 ? null : text.slice(0, at) + replace + text.slice(at + find.length);
}

/** 줄마다 주석을 뗀 코드 */
const codeOf = (text: string): string => text.split('\n').map(stripComment).join('\n');

/** 수식 구간들($…$, $$…$$, \(…\), \[…\], 수식 환경)과, 수식을 빈칸으로 바꾼 나머지 글 */
export function mathSegments(text: string): { segments: string[]; rest: string } {
  const code = codeOf(text);
  const segments: string[] = [];
  const re = new RegExp(String.raw`\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\{(${MATH_ENV_NAMES})(\*?)\}[\s\S]*?\\end\{\1\2\}`, 'g');
  const rest = code.replace(re, (m) => {
    segments.push(m);
    return ' ';
  });
  return { segments, rest };
}

/** 이스케이프되지 않은 글자의 수(\\ 다음 글자는 이스케이프된 것으로 본다) */
function countUnescaped(text: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
      continue;
    }
    if (text[i] === ch) n++;
  }
  return n;
}

/** 중괄호 짝: 끝의 균형(여는 수 - 닫는 수)과, 중간에 닫는 괄호가 더 많아진 적이 있는지 */
function braceShape(text: string): { balance: number; underflow: boolean } {
  const code = codeOf(text);
  let depth = 0;
  let underflow = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth < 0) underflow = true;
    }
  }
  return { balance: depth, underflow };
}

const envSequence = (text: string): string[] => [...codeOf(text).matchAll(/\\(begin|end)\{([^}]+)\}/g)].map((m) => `${m[1]}:${m[2]}`);

const keyBag = (text: string): string[] =>
  [...codeOf(text).matchAll(KEY_COMMANDS)]
    .flatMap((m) => (m[2] as string).split(',').map((k) => `${m[1]}:${k.trim()}`))
    .sort();

const commandBag = (text: string): string[] =>
  [...codeOf(text).matchAll(/\\([A-Za-z@]+)/g)]
    .map((m) => m[1] as string)
    .filter((c) => !ALLOWED_COMMANDS.has(c))
    .sort();

/** 수식 밖에서 이스케이프되지 않은 % & # _ ^ 의 수. %는 주석을 떼기 전 글에서 센다(새 % 는 그 뒤 줄을 주석으로 만든다). */
function specialCounts(text: string): Record<string, number> {
  const withoutMath = text.replace(new RegExp(String.raw`\$\$[\s\S]*?\$\$|(?<!\\)\$(?:\\.|[^$\\])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\\begin\{(${MATH_ENV_NAMES})(\*?)\}[\s\S]*?\\end\{\1\2\}`, 'g'), ' ');
  const out: Record<string, number> = {};
  for (const ch of ['%', '&', '#', '_', '^']) out[ch] = countUnescaped(ch === '%' ? withoutMath : codeOf(withoutMath), ch);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 지시에 수식 이야기가 있으면 수식을 고쳐도 된다 */
export const mentionsMath = (instruction: string): boolean => /수식|공식|방정식|equation|math|formula/i.test(instruction);

export interface TexEditInput {
  mode: 'strict' | 'loose';
  role: TexBlockRole;
  before: string;
  after: string;
  /** 엄격 모드에서 수식을 바꿔도 되는지(지시에 수식이 언급됨) */
  mathAllowed?: boolean;
}

/** 규칙에 맞으면 null, 아니면 어긴 규칙 */
export function checkTexEdit(i: TexEditInput): TexRule | null {
  if (i.mode === 'loose') {
    if (i.role === 'verbatim') return 'role';
    if (blankLineCount(i.before) !== blankLineCount(i.after)) return 'blanks';
    const b = braceShape(i.before);
    const a = braceShape(i.after);
    if (Math.abs(a.balance) > Math.abs(b.balance) || (a.underflow && !b.underflow)) return 'braces';
    return null;
  }
  if (i.role === 'comment' || i.role === 'verbatim' || i.role === 'preamble') return 'role';
  if (blankLineCount(i.before) !== blankLineCount(i.after)) return 'blanks';
  // 짝 맞는 {…} 를 더하거나 빼는 것(\emph{…})은 괜찮고, 짝이 깨지는 것만 막는다.
  if (!same(braceShape(i.before), braceShape(i.after))) return 'braces';
  if (!same(envSequence(i.before), envSequence(i.after))) return 'envs';
  if (!same(keyBag(i.before), keyBag(i.after))) return 'keys';
  if (!i.mathAllowed && !same(mathSegments(i.before).segments, mathSegments(i.after).segments)) return 'math';
  // 수식 밖의 명령만 비교한다(수식을 고쳐도 되는 경우 수식 안 명령은 수식 규칙이 맡는다).
  if (!same(commandBag(mathSegments(i.before).rest), commandBag(mathSegments(i.after).rest))) return 'commands';
  if (!same(specialCounts(i.before), specialCounts(i.after))) return 'specials';
  return null;
}

/** 오류 고치기에서 고칠 수 있는 블록 번호: 진단된 줄이 든 블록과 같은 파일에서 앞뒤 K 블록, 그리고 서문 */
export function fixableBlocks(
  blocks: Array<{ index: number; file: string; line: number; role: TexBlockRole }>,
  diagnostics: Array<{ file: string | null; line: number | null }>,
  k = 2,
): Set<number> {
  const out = new Set<number>();
  for (const b of blocks) if (b.role === 'preamble') out.add(b.index);
  const byFile = new Map<string, typeof blocks>();
  for (const b of blocks) byFile.set(b.file, [...(byFile.get(b.file) ?? []), b]);
  for (const d of diagnostics) {
    if (!d.file || d.line === null) continue;
    const list = (byFile.get(d.file) ?? []).slice().sort((x, y) => x.line - y.line);
    let hit: (typeof blocks)[number] | undefined;
    for (const b of list) if (b.line <= d.line) hit = b;
    if (!hit) continue;
    const seq = seqOf(hit.index);
    for (const b of list) if (Math.abs(seqOf(b.index) - seq) <= k) out.add(b.index);
  }
  return out;
}
