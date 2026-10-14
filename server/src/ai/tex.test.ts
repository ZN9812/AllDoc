// LaTeX AI(M3): 제안 검증(convert), 작업 나누기(tex_chat·tex_fix), 프롬프트, 데모 AI
import { blockIndex, splitTex, type AiRequest, type DocSummary } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { toProposals } from './convert';
import { MockProvider } from './mock';
import { buildSystemPrompt, buildUserContent } from './prompt';
import type { RawOp, RawProposal } from './schema';

const SRC = [
  '\\documentclass{article}', // 1
  '\\usepackage{kotex}', // 2
  '\\begin{document}', // 3
  '몇일 뒤에 그림~\\ref{fig:a} 를 본다. 값은 $x^2$ 이다.', // 4
  '', // 5
  '% 몇일 메모', // 6
  '', // 7
  '\\begin{itemise}', // 8
  '\\item 가', // 9
  '\\end{itemise}', // 10
  '', // 11
  '먼 블록 1', // 12
  '', // 13
  '먼 블록 2', // 14
  '', // 15
  '먼 블록 3 몇일', // 16
  '\\end{document}', // 17
].join('\n');

/** splitTex 로 만든 블록을 웹이 보내는 문서 요약 모양으로 */
function texDoc(): DocSummary {
  return {
    kind: 'tex',
    paragraphs: splitTex(SRC, 'main.tex', 0, true).map((b) => ({ index: b.index, text: b.text, char: {}, para: {}, src: { file: b.file, line: b.line, role: b.role } })),
  };
}

const op = (paragraph: number, find: string, replace: string): RawOp => ({
  type: 'replaceText',
  paragraph,
  find,
  replace,
  fontFamily: null,
  fontSizePt: null,
  bold: null,
  italic: null,
  underline: null,
  align: null,
  lineSpacingPct: null,
});
const prop = (ops: RawOp[]): RawProposal => ({ category: 'spelling', title: '고치기', description: '', before: '', after: '', ops });
const id = () => 'p';
const B = (seq: number) => blockIndex(0, seq);

describe('LaTeX 제안 검증(convert)', () => {
  it('블록 순서: 서문 0, 본문 1, 주석 2, 목록 3, 먼 블록 4~6', () => {
    expect(texDoc().paragraphs.map((p) => [p.index, p.src?.role, p.src?.line])).toEqual([
      [0, 'preamble', 1],
      [1, 'body', 3],
      [2, 'comment', 6],
      [3, 'body', 8],
      [4, 'body', 12],
      [5, 'body', 14],
      [6, 'body', 16],
    ]);
  });

  it('대화(tex_chat): 본문 글 고치기는 통과하고, 키·수식·주석·서문을 바꾸는 제안은 버린다', () => {
    const ctx = { task: 'tex_chat' as const, instruction: '맞춤법' };
    const r = toProposals(
      [
        prop([op(B(1), '몇일', '며칠')]),
        prop([op(B(1), 'fig:a', 'fig:b')]),
        prop([op(B(1), '$x^2$', '$x^3$')]),
        prop([op(B(2), '몇일', '며칠')]),
        prop([op(B(0), 'kotex', 'kotex,amsmath')]),
        // 줄 끝에 이스케이프 안 된 % 를 넣는 제안(뒤의 글을 주석으로 만든다)
        prop([op(B(1), '$x^2$ 이다.', '$x^2$ 이다 50%.')]),
      ],
      texDoc(),
      id,
      ctx,
    );
    expect(r.proposals.map((p) => p.ops[0])).toEqual([{ type: 'replaceText', paragraph: B(1), find: '몇일', replace: '며칠' }]);
    expect(r.dropped).toBe(5);
    expect(r.rejected).toEqual(['keys', 'math', 'role', 'role', 'specials']);
  });

  it('지시에 수식이 언급되면 수식을 고치는 제안을 받는다', () => {
    const r = toProposals([prop([op(B(1), '$x^2$', '$x^3$')])], texDoc(), id, { task: 'tex_chat', instruction: '수식의 지수를 3으로 고쳐 줘' });
    expect(r.proposals).toHaveLength(1);
  });

  it('오류 고치기(tex_fix): 진단된 줄 근처와 서문만, 환경 이름은 고칠 수 있고, 변경은 5개까지', () => {
    const ctx = {
      task: 'tex_fix' as const,
      instruction: '',
      compile: { diagnostics: [{ severity: 'error' as const, file: 'main.tex', line: 8, message: 'LaTeX Error: Environment itemise undefined.' }], logExcerpt: '' },
    };
    const r = toProposals(
      [
        prop([op(B(3), '{itemise}', '{itemize}'), op(B(3), '{itemise}', '{itemize}')]),
        prop([op(B(0), '\\usepackage{kotex}', '\\usepackage{kotex}\n\\usepackage{enumitem}')]),
        // 순번 6 은 진단 블록(3)에서 3블록 떨어져 있다.
        prop([op(B(6), '몇일', '며칠')]),
        prop(Array.from({ length: 6 }, () => op(B(3), '가', '나'))),
      ],
      texDoc(),
      id,
      ctx,
    );
    expect(r.proposals).toHaveLength(2);
    expect(r.rejected).toEqual(['near']);
    expect(r.dropped).toBe(2);
  });

  it('LaTeX 가 아닌 문서에는 LaTeX 규칙을 적용하지 않는다', () => {
    const doc: DocSummary = { kind: 'txt', paragraphs: [{ index: 0, text: '50% 이다 \\ref{a}', char: {}, para: {} }] };
    expect(toProposals([prop([op(0, '\\ref{a}', '\\ref{b}')])], doc, id).proposals).toHaveLength(1);
  });
});

describe('LaTeX 프롬프트', () => {
  it('작업마다 다른 시스템 프롬프트를 쓴다', () => {
    expect(buildSystemPrompt('tex_chat')).toContain('이번 작업: 대화');
    expect(buildSystemPrompt('tex_chat')).toContain('\\label·\\ref·\\eqref·\\cite');
    expect(buildSystemPrompt('tex_fix')).toContain('컴파일 오류 고치기');
    expect(buildSystemPrompt('tex_fix')).toContain("File `x.sty' not found");
    expect(buildSystemPrompt('chat')).not.toContain('LaTeX');
  });

  it('블록은 [번호] (파일 줄행, 역할) "글" 로, 오류 고치기는 <compile> 을 함께 보낸다', () => {
    const req: AiRequest = {
      mode: 'tex_fix',
      instruction: '오류를 고쳐 줘',
      document: texDoc(),
      compile: { diagnostics: [{ severity: 'error', file: 'main.tex', line: 8, message: 'LaTeX Error: Environment itemise undefined.' }], logExcerpt: './main.tex:8: LaTeX Error' },
    };
    const text = buildUserContent(req);
    expect(text).toContain('[3] (main.tex 8행, 본문) "\\\\begin{itemise}\\n\\\\item 가\\n\\\\end{itemise}"');
    expect(text).toContain('[0] (main.tex 1행, 서문)');
    expect(text).toContain('<compile>');
    expect(text).toContain('오류 main.tex:8 LaTeX Error: Environment itemise undefined.');
    expect(text).toContain('<log>"./main.tex:8: LaTeX Error"</log>');
  });
});

describe('데모 AI(LaTeX)', () => {
  const mock = new MockProvider();
  it('대화: 본문 블록의 오타만 고친다(주석 블록의 "몇일" 은 그대로)', async () => {
    const r = await mock.propose({ request: { mode: 'chat', instruction: '맞춤법', document: texDoc() } });
    const ops = r.proposals.flatMap((p) => p.ops.map((o) => o.paragraph));
    expect(ops.sort()).toEqual([B(1), B(6)]);
    // 서버 검증도 통과한다.
    expect(toProposals(r.proposals, texDoc(), id, { task: 'tex_chat', instruction: '맞춤법' }).dropped).toBe(0);
  });

  it('오류 고치기: itemise → itemize 제안이 서버 검증을 통과하고, 패키지가 없다는 오류는 설명만 한다', async () => {
    const compile = { diagnostics: [{ severity: 'error' as const, file: 'main.tex', line: 8, message: 'LaTeX Error: Environment itemise undefined.' }], logExcerpt: '' };
    const r = await mock.propose({ request: { mode: 'tex_fix', instruction: '', document: texDoc(), compile } });
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0]?.ops).toHaveLength(2);
    expect(toProposals(r.proposals, texDoc(), id, { task: 'tex_fix', instruction: '', compile }).proposals).toHaveLength(1);
    const pkg = await mock.propose({
      request: { mode: 'tex_fix', instruction: '', document: texDoc(), compile: { diagnostics: [{ severity: 'error', file: 'main.tex', line: 2, message: "LaTeX Error: File `nope.sty' not found." }], logExcerpt: '' } },
    });
    expect(pkg.proposals).toEqual([]);
    expect(pkg.reply).toContain('nope.sty');
  });
});

describe('LaTeX 작업 설정', () => {
  it('tex_chat·tex_fix 는 기본으로 LaTeX 프롬프트를 쓰고, 설정 파일로 작업마다 모델을 바꿀 수 있다', async () => {
    const { testConfig } = await import('../test-support/helpers');
    const base = testConfig();
    expect(base.ai.tex_chat.systemPrompt).toContain('LaTeX');
    expect(base.ai.tex_fix.systemPrompt).toContain('컴파일 오류 고치기');
    const c = testConfig({ AI_CONFIG_PATH: 'ai.json' }, { 'ai.json': JSON.stringify({ tasks: { tex_fix: { model: 'claude-haiku-5-5' } } }) });
    expect(c.ai.tex_fix.model).toBe('claude-haiku-5-5');
    expect(c.ai.tex_chat.model).toBe(base.ai.tex_chat.model);
  });
});
