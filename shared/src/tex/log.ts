// LaTeX 로그 해석. 컴파일 일꾼이 돌려준 로그(-file-line-error, max_print_line=10000 로 줄바꿈 없음)에서
// 오류·경고를 뽑아 "파일:줄" 로 돌려준다. 웹(컴파일 탭)과 서버(응답 만들기)가 함께 쓴다.
//
// 읽는 형식:
//   ./ch1.tex:42: Undefined control sequence.          오류(-file-line-error). 줄 번호는 그대로 믿는다.
//   ! LaTeX Error: File `x.sty' not found.              파일·줄이 없는 오류. 지금 열린 파일과 뒤따르는 "l.<줄>" 로 채운다.
//   LaTeX Warning: … on input line 57.                  경고. 어느 파일인지는 로그의 "(파일 … )" 괄호를 따라가서 찾는다.
//   Package foo Warning: … / (foo)   … on input line 3.  패키지 경고. "(foo)" 로 시작하는 다음 줄은 이어지는 글이다.
//   Overfull/Underfull \hbox … at lines 12--13           상자 경고
//   Warning--I didn't find a database entry for "x"      BibTeX(.blg)
//   [229] Biber.pm:131> WARN - … / ERROR - …            Biber(.blg)

export type TexSeverity = 'error' | 'warning' | 'info';

export interface TexDiagnostic {
  severity: TexSeverity;
  /** 프로젝트 안 상대 경로("./" 를 뗀 것). 알 수 없거나 프로젝트 밖(TeX Live 의 .sty 등)이면 그 경로 그대로, 모르면 null */
  file: string | null;
  line: number | null;
  message: string;
}

/** 진단을 너무 많이 돌려주지 않는다(로그 폭주 대비) */
export const MAX_DIAGNOSTICS = 200;

const FILE_LINE_ERROR = /^((?:\.{1,2}\/|\/)?[^:\s][^:]*?\.(?:tex|ltx|sty|cls|bib|bbl|def|cfg|clo|dtx|fd)):(\d+): (.+)$/;
const BANG = /^! (.+)$/;
const CONTEXT_LINE = /^l\.(\d+) /;
const LATEX_WARNING = /^((?:LaTeX|LaTeX Font|Class \S+|Package \S+)(?: Warning|  Warning)): (.*)$/;
const BOX = /^((?:Over|Under)full \\[hv]box .*?)(?: (?:in paragraph|in alignment) at lines (\d+)--\d+| detected at line (\d+)| has occurred while \\output is active)?$/;
const ON_INPUT_LINE = /\s*on input line (\d+)\.?\s*$/;
const BIBTEX_WARNING = /^Warning--(.+)$/;
const BIBER = /^(?:\[\d+\] [\w.]+:\d+> |Biber )?(WARN|ERROR) - (.+)$/;
/** "(fontspec)   이어지는 글" 처럼 패키지 경고·정보의 이어지는 줄 */
const CONTINUATION = /^\(([A-Za-z][\w@.-]*)\)\s+(.*)$/;

/** 로그의 괄호에서 파일 이름처럼 보이는 것(경로 문자 + 확장자). 공백이 든 파일 이름은 따라가지 못한다(알려진 한계). */
const PAREN_FILE = /^\(((?:\.{1,2}\/|\/)?[^\s()[\]{}"']+\.[A-Za-z0-9]+)/;

export function normalizeLogPath(p: string): string {
  let s = p;
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

/** 줄 하나의 괄호를 읽어 열린 파일 목록을 갱신한다. 파일이 아닌 괄호도 짝을 맞추려고 null 로 넣는다. */
function trackParens(line: string, stack: Array<string | null>): void {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') {
      const m = PAREN_FILE.exec(line.slice(i));
      if (m) {
        stack.push(normalizeLogPath(m[1] as string));
        i += (m[0] as string).length - 1;
      } else stack.push(null);
    } else if (ch === ')') {
      if (stack.length > 0) stack.pop();
    }
  }
}

function currentFile(stack: Array<string | null>): string | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const f = stack[i];
    if (f) return f;
  }
  return null;
}

/** 로그(와 이어 붙인 .blg)를 읽어 진단 목록을 돌려준다. 같은 것은 한 번만 넣는다. */
export function parseTexLog(log: string): TexDiagnostic[] {
  const lines = log.replace(/\r\n?/g, '\n').split('\n');
  const out: TexDiagnostic[] = [];
  const seen = new Set<string>();
  const stack: Array<string | null> = [];
  const push = (d: TexDiagnostic) => {
    const key = `${d.severity}\u0000${d.file}\u0000${d.line}\u0000${d.message}`;
    if (seen.has(key) || out.length >= MAX_DIAGNOSTICS) return;
    seen.add(key);
    out.push(d);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    // 패키지 경고의 이어지는 줄은 괄호를 세지 않는다("(fontspec)   this)." 의 닫는 괄호가 파일을 닫지 않도록).
    if (CONTINUATION.test(line)) continue;

    let m = FILE_LINE_ERROR.exec(line);
    if (m) {
      const file = normalizeLogPath(m[1] as string);
      const ln = Number(m[2]);
      const message = (m[3] as string).trim();
      // "Emergency stop" 은 앞의 진짜 오류를 따라오는 것이라 앞에 "! …" 오류가 있었다면 그 위치만 채운다.
      const prev = out[out.length - 1];
      if (message === 'Emergency stop.' && prev && prev.severity === 'error') {
        if (prev.line === null) {
          prev.file = file;
          prev.line = ln;
        }
        continue;
      }
      push({ severity: 'error', file, line: ln, message });
      continue;
    }

    m = BANG.exec(line);
    if (m) {
      const message = (m[1] as string).trim();
      // 바로 앞 "./a.tex:3: X" 와 같은 오류면 넘긴다.
      const prev = out[out.length - 1];
      if (prev && prev.severity === 'error' && prev.message === message) continue;
      let ln: number | null = null;
      for (let j = i + 1; j < Math.min(lines.length, i + 12); j++) {
        const c = CONTEXT_LINE.exec(lines[j] as string);
        if (c) {
          ln = Number(c[1]);
          break;
        }
      }
      push({ severity: 'error', file: ln !== null ? currentFile(stack) : null, line: ln, message });
      continue;
    }

    m = LATEX_WARNING.exec(line);
    if (m) {
      // 이어지는 줄("(hyperref)   …")을 붙인다.
      let text = (m[2] as string).trim();
      let j = i + 1;
      while (j < lines.length) {
        const c = CONTINUATION.exec(lines[j] as string);
        if (!c) break;
        text += ` ${(c[2] as string).trim()}`;
        j++;
      }
      const at = ON_INPUT_LINE.exec(text);
      const message = `${(m[1] as string).replace('  ', ' ')}: ${text.replace(ON_INPUT_LINE, '').trim()}`;
      const isInfo = /There were undefined references|Some font shapes were not available|Rerun to get/.test(text);
      push({ severity: isInfo ? 'info' : 'warning', file: at ? currentFile(stack) : null, line: at ? Number(at[1]) : null, message });
      i = j - 1;
      continue;
    }

    m = BOX.exec(line);
    if (m && /^(?:Over|Under)full/.test(line)) {
      const ln = m[2] ?? m[3];
      push({ severity: 'warning', file: ln ? currentFile(stack) : null, line: ln ? Number(ln) : null, message: (m[1] as string).trim() });
      trackParens(line.replace(/^.*?(?:at lines \d+--\d+|detected at line \d+)/, ''), stack);
      continue;
    }

    m = BIBTEX_WARNING.exec(line);
    if (m) {
      push({ severity: 'warning', file: null, line: null, message: `BibTeX: ${(m[1] as string).trim()}` });
      continue;
    }
    m = BIBER.exec(line);
    if (m) {
      push({ severity: m[1] === 'ERROR' ? 'error' : 'warning', file: null, line: null, message: `Biber: ${(m[2] as string).trim()}` });
      continue;
    }

    trackParens(line, stack);
  }
  return out;
}

/** 진단 개수(화면의 "오류 3" 표시용) */
export function countBySeverity(ds: TexDiagnostic[]): Record<TexSeverity, number> {
  const r: Record<TexSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const d of ds) r[d.severity]++;
  return r;
}
