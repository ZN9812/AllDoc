import { blockIndex, textGuard } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { applyAtomic } from '../applyOps';
import { applyTexOp, rangeOfTarget, SlotTable, summarizeProject } from './model';

const MAIN = '\\documentclass{article}\n\\begin{document}\n몇일 뒤 몇일\n\n\\begin{verbatim}\n몇일\n\\end{verbatim}\n\n끝\n\\end{document}\n';
const CH = '\\section{가}\n\n본문 몇일\n';

describe('LaTeX 프로젝트 모델', () => {
  it('파일칸은 경로 순으로 정하고 새 파일은 다음 칸, 이름을 바꾸면 새 칸', () => {
    const t = new SlotTable(['main.tex', 'ch/1.tex']);
    expect(t.slotFor('ch/1.tex')).toBe(0);
    expect(t.slotFor('main.tex')).toBe(1);
    expect(t.slotFor('new.tex')).toBe(2);
    t.forget('main.tex');
    expect(t.slotFor('main.tex')).toBe(3);
    expect(t.pathOf(2)).toBe('new.tex');
  });

  it('요약: verbatim 은 빼고, 블록마다 파일·줄·역할을 붙인다. 선택 범위만 보낼 수도 있다', () => {
    const slots = new SlotTable(['main.tex', 'ch.tex']);
    const files = [
      { path: 'main.tex', text: MAIN },
      { path: 'ch.tex', text: CH },
    ];
    const s = summarizeProject(files, slots, 'main.tex');
    expect(s.paragraphs.map((p) => [p.index, p.src?.file, p.src?.line, p.src?.role])).toEqual([
      [blockIndex(1, 0), 'main.tex', 1, 'preamble'],
      [blockIndex(1, 1), 'main.tex', 2, 'body'],
      [blockIndex(1, 3), 'main.tex', 9, 'body'],
      [blockIndex(0, 0), 'ch.tex', 1, 'body'],
      [blockIndex(0, 1), 'ch.tex', 3, 'body'],
    ]);
    const sel = summarizeProject(files, slots, 'main.tex', { path: 'main.tex', from: 9, to: 9 });
    expect(sel.paragraphs.map((p) => p.index)).toEqual([blockIndex(1, 3)]);
  });

  it('적용: 블록 안 첫 위치만 바꾸고, 되돌리기는 그 자리를 정확히 되돌린다', async () => {
    const slots = new SlotTable(['main.tex']);
    let file = { path: 'main.tex', text: MAIN };
    const idx = blockIndex(0, 1);
    const guard = textGuard('\\begin{document}\n몇일 뒤 몇일');
    const one = async (op: Parameters<typeof applyTexOp>[3]) => {
      const r = applyTexOp(file, 0, 'main.tex', op);
      if (!r.ok) return r;
      file = { ...file, text: r.text };
      return { ok: true as const, inverse: r.inverse };
    };
    const r = await applyAtomic(one, [
      { type: 'replaceText', paragraph: idx, find: '몇일', replace: '며칠', guard },
      { type: 'replaceText', paragraph: idx, find: '몇일', replace: '며칠', guard },
    ]);
    expect(r.ok).toBe(true);
    expect(file.text).toContain('며칠 뒤 며칠');
    // verbatim 안의 "몇일" 은 그대로
    expect(file.text).toContain('\\begin{verbatim}\n몇일');
    if (!r.ok) return;
    await applyAtomic(one, r.inverse);
    expect(file.text).toBe(MAIN);
  });

  it('지문이 다르거나, 서식 변경이거나, 다른 파일 블록이면 적용하지 않는다', () => {
    const f = { path: 'main.tex', text: MAIN };
    expect(applyTexOp(f, 0, 'main.tex', { type: 'replaceText', paragraph: blockIndex(0, 1), find: '몇일', replace: '며칠', guard: 'deadbeef' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(applyTexOp(f, 0, 'main.tex', { type: 'setCharStyle', paragraph: blockIndex(0, 1), style: { bold: true } })).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(applyTexOp(f, 0, 'main.tex', { type: 'replaceText', paragraph: blockIndex(1, 1), find: '몇일', replace: '며칠' })).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('표시 범위는 파일 글 기준', () => {
    const f = { path: 'main.tex', text: MAIN };
    const r = rangeOfTarget(f, 0, 'main.tex', { paragraph: blockIndex(0, 3), find: '끝' });
    expect(r && MAIN.slice(r[0], r[1])).toBe('끝');
    // 같은 블록의 두 번째 "몇일"
    const two = rangeOfTarget(f, 0, 'main.tex', { paragraph: blockIndex(0, 1), find: '몇일' }, 1);
    expect(two && two[0]).toBe(MAIN.indexOf('몇일', MAIN.indexOf('몇일') + 1));
    expect(rangeOfTarget(f, 0, 'main.tex', { paragraph: blockIndex(0, 1), find: '몇일' }, 2)).toBeNull();
    expect(rangeOfTarget(f, 0, 'main.tex', { paragraph: blockIndex(0, 3) })).toEqual([MAIN.indexOf('끝'), MAIN.indexOf('\\end{document}') + '\\end{document}'.length]);
  });
});
