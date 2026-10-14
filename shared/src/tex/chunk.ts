// LaTeX 원고를 AI 가 다루는 "블록"으로 나눈다(docs/LATEX.md "블록 모델"). 웹(요약·적용)과 서버(검증)가 같이 쓴다.
// - .tex: 빈 줄을 경계로 나눈다(LaTeX 의 문단 단위). 주 파일의 \begin{document} 앞은 서문 블록 하나다.
//   수식·verbatim 환경 안의 빈 줄에서는 나누지 않는다(환경이 두 블록으로 쪼개지지 않게).
// - .bib: @항목 하나가 블록 하나다.
// - 번호 = 파일칸 × 100000 + 순번. 파일칸은 프로젝트를 열 때 정한다(한 파일을 고쳐도 다른 파일의 제안 번호가 밀리지 않는다).
// 블록 글은 파일 글의 [start, end) 를 그대로 자른 것이고, 블록 사이의 빈 줄은 어느 블록에도 들지 않는다.

export const TEX_BLOCK_ROLES = ['preamble', 'comment', 'math', 'verbatim', 'body', 'bib'] as const;
export type TexBlockRole = (typeof TEX_BLOCK_ROLES)[number];

export const TEX_ROLE_LABEL: Record<TexBlockRole, string> = {
  preamble: '서문',
  comment: '주석',
  math: '수식',
  verbatim: 'verbatim',
  body: '본문',
  bib: '참고문헌',
};

/** 한 파일에 둘 수 있는 블록 수(번호 칸). 넘는 블록은 AI 에 보내지 않는다. */
export const SLOT_SIZE = 100_000;

export interface TexBlock {
  /** 파일칸 × SLOT_SIZE + 순번 */
  index: number;
  file: string;
  /** 시작 줄(1부터) */
  line: number;
  /** 끝 줄(1부터, 포함) */
  endLine: number;
  role: TexBlockRole;
  text: string;
  /** 파일 글 안의 위치 [start, end) */
  start: number;
  end: number;
}

export const blockIndex = (slot: number, seq: number): number => slot * SLOT_SIZE + seq;
export const slotOf = (index: number): number => Math.floor(index / SLOT_SIZE);
export const seqOf = (index: number): number => index % SLOT_SIZE;

const VERBATIM_ENVS = ['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'lstlisting', 'minted', 'comment', 'filecontents', 'filecontents*'];
const MATH_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'flalign', 'flalign*', 'alignat', 'alignat*'];
export const PROTECTED_ENVS = [...VERBATIM_ENVS, ...MATH_ENVS];

/** 줄의 주석(이스케이프되지 않은 % 부터 끝까지)을 뺀다 */
export function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
      continue;
    }
    if (line[i] === '%') return line.slice(0, i);
  }
  return line;
}

const isBlank = (line: string) => line.trim() === '';
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Line {
  text: string;
  start: number;
  /** 줄 끝(줄바꿈 앞) */
  end: number;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let at = 0;
  for (const t of text.split('\n')) {
    out.push({ text: t, start: at, end: at + t.length });
    at += t.length + 1;
  }
  return out;
}

/** 이 줄 이후 닫히지 않은 보호 환경(수식·verbatim, 여러 줄에 걸친 \[ … \]). 없으면 null */
function openProtected(line: string, current: string | null): string | null {
  let env = current;
  // verbatim 안에서는 % 도 글이므로 주석을 떼지 않는다.
  const code = env && VERBATIM_ENVS.includes(env) ? line : stripComment(line);
  for (const m of code.matchAll(/\\(begin|end)\{([^}]+)\}|\\\[|\\\]/g)) {
    if (m[0] === '\\[') {
      if (env === null) env = '\\[';
    } else if (m[0] === '\\]') {
      if (env === '\\[') env = null;
    } else {
      const name = m[2] as string;
      if (env === null && m[1] === 'begin' && PROTECTED_ENVS.includes(name)) env = name;
      else if (env !== null && m[1] === 'end' && name === env) env = null;
    }
  }
  return env;
}

function classify(text: string, isPreamble: boolean): TexBlockRole {
  if (isPreamble) return 'preamble';
  const lines = text.split('\n').filter((l) => !isBlank(l));
  if (lines.length > 0 && lines.every((l) => /^\s*%/.test(l))) return 'comment';
  const code = lines.map(stripComment).join('\n');
  if (new RegExp(`\\\\begin\\{(${VERBATIM_ENVS.map(escapeRe).join('|')})\\}`).test(text) || /\\verb\*?([^a-zA-Z\s])/.test(code)) return 'verbatim';
  const trimmed = code.trim();
  const mathOnly =
    new RegExp(`^\\\\begin\\{(${MATH_ENVS.map(escapeRe).join('|')})\\}[\\s\\S]*\\\\end\\{\\1\\}$`).test(trimmed) ||
    /^\\\[[\s\S]*\\\]$/.test(trimmed) ||
    /^\$\$[\s\S]*\$\$$/.test(trimmed);
  return mathOnly ? 'math' : 'body';
}

/** 주 파일에서 \begin{document} 가 있는 줄의 번호(0부터). 없으면 -1 */
function documentStart(lines: Line[]): number {
  return lines.findIndex((l) => /\\begin\{document\}/.test(stripComment(l.text)));
}

/** .tex 글을 블록으로 나눈다. isMain 이면 \begin{document} 앞을 서문 블록 하나로 둔다. */
export function splitTex(text: string, file: string, slot: number, isMain: boolean): TexBlock[] {
  const lines = linesOf(text);
  const blocks: TexBlock[] = [];
  const push = (from: number, to: number, preamble: boolean) => {
    // 앞뒤 빈 줄은 블록에 넣지 않는다.
    while (from <= to && isBlank((lines[from] as Line).text)) from++;
    while (to >= from && isBlank((lines[to] as Line).text)) to--;
    if (from > to) return;
    const start = (lines[from] as Line).start;
    const end = (lines[to] as Line).end;
    const t = text.slice(start, end);
    blocks.push({ index: blockIndex(slot, blocks.length), file, line: from + 1, endLine: to + 1, role: classify(t, preamble), text: t, start, end });
  };

  let first = 0;
  const docAt = isMain ? documentStart(lines) : -1;
  if (docAt > 0) {
    push(0, docAt - 1, true);
    first = docAt;
  }
  let env: string | null = null;
  let from = first;
  for (let i = first; i < lines.length; i++) {
    const l = lines[i] as Line;
    if (env === null && isBlank(l.text)) {
      push(from, i - 1, false);
      from = i + 1;
      continue;
    }
    env = openProtected(l.text, env);
  }
  push(from, lines.length - 1, false);
  return blocks.slice(0, SLOT_SIZE);
}

/** .bib 글을 @항목마다 블록으로 나눈다(항목 사이의 글은 블록에 넣지 않는다). */
export function splitBib(text: string, file: string, slot: number): TexBlock[] {
  const lines = linesOf(text);
  const starts = lines.map((l, i) => (/^\s*@\w+\s*[{(]/.test(l.text) ? i : -1)).filter((i) => i >= 0);
  const blocks: TexBlock[] = [];
  starts.forEach((s, k) => {
    let to = (k + 1 < starts.length ? (starts[k + 1] as number) : lines.length) - 1;
    while (to > s && isBlank((lines[to] as Line).text)) to--;
    const start = (lines[s] as Line).start;
    const end = (lines[to] as Line).end;
    blocks.push({ index: blockIndex(slot, blocks.length), file, line: s + 1, endLine: to + 1, role: 'bib', text: text.slice(start, end), start, end });
  });
  return blocks.slice(0, SLOT_SIZE);
}

/** 파일 종류에 맞게 나눈다. .tex·.bib 가 아니면 빈 목록 */
export function splitFile(text: string, file: string, slot: number, isMain: boolean): TexBlock[] {
  if (/\.(tex|ltx)$/i.test(file)) return splitTex(text, file, slot, isMain);
  if (/\.bib$/i.test(file)) return splitBib(text, file, slot);
  return [];
}

/** 블록 글 안(앞뒤 빈 줄 제외)의 빈 줄 수. 블록을 고쳐도 이 수가 같아야 블록 번호가 유지된다. */
export function blankLineCount(text: string): number {
  const ls = text.split('\n');
  while (ls.length > 0 && isBlank(ls[0] as string)) ls.shift();
  while (ls.length > 0 && isBlank(ls[ls.length - 1] as string)) ls.pop();
  return ls.filter(isBlank).length;
}

/** 줄 번호(1부터)가 들어 있는 블록. 없으면 그 앞의 가장 가까운 블록 */
export function blockAtLine(blocks: TexBlock[], line: number): TexBlock | undefined {
  let best: TexBlock | undefined;
  for (const b of blocks) {
    if (b.line <= line) best = b;
    else break;
  }
  return best;
}
