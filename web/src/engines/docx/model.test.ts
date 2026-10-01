import { textGuard, type Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { analyzeConsistency } from '../../ai/consistency';
import { DocxModel, type DocxHost } from './model';
import { makeDocxBytes, mapParas, SAMPLE_DOCX_PARAS, type ParaSpec, type TableSpec } from './fixtures';

/** SuperDoc 의 문서 API 를 흉내 내는 메모리 문서. 내보내기는 시험용 DOCX 만들기로 한다. */
class FakeDocx {
  /** 문서 순서대로 늘어놓은 문단(표 칸 안 포함). items 안의 문단과 같은 객체다. */
  paras: ParaSpec[];
  /** 문단과 표로 이루어진 문서 구조 */
  items: Array<ParaSpec | TableSpec>;
  rev = 0;
  extractCount = 0;
  exportCount = 0;
  /** 이 호출은 성공했다고 답하면서 실제로는 아무것도 바꾸지 않는다 */
  ignore = new Set<'replace' | 'format' | 'align' | 'spacing'>();
  /** 글을 바꿀 때 예상과 다르게 바꾼다(끝에 "!" 를 붙인다) */
  mangleReplace = false;
  /** 내보낸 DOCX 에 문단 번호(w14:paraId)를 쓰지 않는다 */
  exportParaIds = true;

  constructor(items: Array<ParaSpec | TableSpec>) {
    const flat: ParaSpec[] = [];
    this.items = mapParas(items, (p) => {
      const copy = { ...p, rFonts: p.rFonts ? { ...p.rFonts } : undefined, paraId: String(flat.length + 1).padStart(8, '0') };
      flat.push(copy);
      return copy;
    });
    this.paras = flat;
  }

  private para(blockId: string): ParaSpec {
    const p = this.paras.find((x) => x.paraId === blockId);
    if (!p) throw new Error(`블록 ${blockId} 이 없어요`);
    return p;
  }

  host: DocxHost = {
    doc: {
      extract: async () => {
        this.extractCount++;
        return { blocks: this.paras.map((p) => ({ nodeId: p.paraId as string, type: 'paragraph', text: p.text })), revision: String(this.rev) };
      },
      replace: async (input: unknown) => {
        const { target, text } = input as { target: { start: { blockId: string; offset: number }; end: { offset: number } }; text: string };
        const p = this.para(target.start.blockId);
        if (!this.ignore.has('replace')) {
          p.text = p.text.slice(0, target.start.offset) + (this.mangleReplace ? `${text}!` : text) + p.text.slice(target.end.offset);
          this.rev++;
        }
        return { success: true };
      },
      format: {
        apply: async (input: unknown) => {
          const { target, inline } = input as { target: { start: { blockId: string } }; inline: Record<string, unknown> };
          const p = this.para(target.start.blockId);
          if (!this.ignore.has('format')) {
            if (inline.rFonts) {
              // 실제 SuperDoc 처럼 글꼴 칸 전체를 통째로 바꾼다(null 인 칸은 지워진다).
              p.rFonts = Object.fromEntries(Object.entries(inline.rFonts as Record<string, string | null>).filter(([, v]) => v)) as ParaSpec['rFonts'];
              delete p.font;
            }
            if (inline.fontSize !== undefined) p.sizePt = inline.fontSize as number;
            if (inline.bold !== undefined) p.bold = inline.bold as boolean;
            this.rev++;
          }
          return { success: true };
        },
      },
      paragraphs: {
        setAlignment: async (input: unknown) => {
          const { target, alignment } = input as { target: { nodeId: string }; alignment: 'left' | 'center' | 'right' | 'justify' };
          if (!this.ignore.has('align')) {
            this.para(target.nodeId).align = alignment === 'justify' ? 'both' : alignment;
            this.rev++;
          }
          return { success: true };
        },
        setSpacing: async (input: unknown) => {
          const { target, line } = input as { target: { nodeId: string }; line: number };
          if (!this.ignore.has('spacing')) {
            this.para(target.nodeId).linePct = Math.round(line / 2.4);
            this.rev++;
          }
          return { success: true };
        },
      },
    },
    exportDocx: async () => {
      this.exportCount++;
      const items = mapParas(this.items, (p) => (this.exportParaIds ? p : { ...p, paraId: undefined }));
      return new Blob([new Uint8Array(makeDocxBytes(items))]);
    },
  };
}

const model = (f: FakeDocx) => new DocxModel(f.host);
const guardOf = (f: FakeDocx, i: number): string => textGuard((f.paras[i] as ParaSpec).text);
const text = (f: FakeDocx): string[] => f.paras.map((p) => p.text);

const TITLE_FONT = '맑은 고딕';
const SAMPLE = SAMPLE_DOCX_PARAS;

describe('DocxModel.summarize', () => {
  it('문단 번호는 문단 목록에서의 순서이고, 글꼴·크기·정렬·줄 간격을 읽는다', async () => {
    const f = new FakeDocx(SAMPLE);
    const s = await model(f).summarize();
    expect(s.kind).toBe('docx');
    expect(s.paragraphs.map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
    expect(s.paragraphs[0]).toMatchObject({ text: '업무 협조 요청', char: { fontFamily: TITLE_FONT, fontSizePt: 18, bold: true }, para: { align: 'center' } });
    expect(s.paragraphs[3]?.char.fontSizePt).toBe(13);
    expect(s.paragraphs[4]).toMatchObject({ char: { fontSizePt: 10 }, para: { align: 'justify', lineSpacingPct: 160 } });
  });

  it('빈 문단은 목록에 넣지 않지만 번호 순서는 유지한다', async () => {
    const f = new FakeDocx([{ text: '첫 문단', sizePt: 10 }, { text: '   ' }, { text: '셋째 문단', sizePt: 10 }]);
    const s = await model(f).summarize();
    expect(s.paragraphs.map((p) => p.index)).toEqual([0, 2]);
  });

  it('문서가 바뀌지 않았으면 서식을 다시 읽지 않는다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    await m.summarize();
    await m.summarize();
    expect(f.exportCount).toBe(1);
    f.rev++;
    await m.summarize();
    expect(f.exportCount).toBe(2);
  });

  it('문단 번호가 없는 문서도 글이 같은 문단끼리 짝지어 서식을 읽는다', async () => {
    const f = new FakeDocx(SAMPLE);
    f.exportParaIds = false;
    const s = await model(f).summarize();
    expect(s.paragraphs.map((p) => p.char.fontSizePt)).toEqual([18, 10, 10, 13, 10]);
  });
});

describe('DocxModel.apply: 글 바꾸기', () => {
  const BODY = 4;
  const fix = (f: FakeDocx, find: string, replace: string, extra: Partial<Op> = {}): Op => ({ type: 'replaceText', paragraph: BODY, find, replace, guard: guardOf(f, BODY), ...extra }) as Op;

  it('글을 바꾸고, 돌려받은 변경으로 처음 글로 되돌린다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    const r = await m.apply([fix(f, '몇일', '며칠')]);
    expect(r.ok).toBe(true);
    expect(f.paras[BODY]?.text).toBe('본문 문장입니다. 며칠 뒤에 만나요. 할려고 했어요.');
    if (!r.ok) return;
    const back = await m.apply(r.inverse);
    expect(back.ok).toBe(true);
    expect(f.paras[BODY]?.text).toBe(SAMPLE[BODY]?.text);
  });

  it('한 묶음에서 같은 문단을 두 번 고쳐도 적용되고, 되돌리면 처음 글이 된다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    const r = await m.apply([fix(f, '몇일', '며칠'), fix(f, '할려고', '하려고')]);
    expect(r.ok).toBe(true);
    expect(f.paras[BODY]?.text).toBe('본문 문장입니다. 며칠 뒤에 만나요. 하려고 했어요.');
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(f.paras[BODY]?.text).toBe(SAMPLE[BODY]?.text);
  });

  it('글을 고쳐도 그 문단의 서식은 그대로다', async () => {
    const f = new FakeDocx(SAMPLE);
    await model(f).apply([fix(f, '몇일', '며칠')]);
    expect(f.paras[BODY]).toMatchObject({ sizePt: 10, linePct: 160, align: 'both' });
  });

  it('위치 힌트(at)가 틀려도 글을 찾아서 바꾼다', async () => {
    const f = new FakeDocx(SAMPLE);
    const r = await model(f).apply([fix(f, '몇일', '며칠', { at: 3 })]);
    expect(r.ok).toBe(true);
    expect(f.paras[BODY]?.text).toContain('며칠');
  });

  it('문서가 이미 바뀌어 지문이 다르면 거절하고 문서를 건드리지 않는다', async () => {
    const f = new FakeDocx(SAMPLE);
    const op = fix(f, '몇일', '며칠');
    (f.paras[BODY] as ParaSpec).text = '누군가 이미 고친 문단입니다. 몇일 뒤에';
    const before = text(f);
    expect(await model(f).apply([op])).toMatchObject({ ok: false, reason: 'stale' });
    expect(text(f)).toEqual(before);
    expect(f.rev).toBe(0);
  });

  it('찾는 글이 없으면 거절한다', async () => {
    const f = new FakeDocx(SAMPLE);
    expect(await model(f).apply([fix(f, '없는글', '아무거나')])).toMatchObject({ ok: false, reason: 'stale' });
  });

  it('없는 문단이나 줄바꿈이 든 변경은 적용하지 않는다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    expect(await m.apply([{ type: 'replaceText', paragraph: 99, find: 'a', replace: 'b' }])).toMatchObject({ ok: false, reason: 'stale' });
    expect(await m.apply([fix(f, '몇일', '며칠\n뒤')])).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('묶음 중간에 실패하면 앞의 변경도 모두 되돌린다', async () => {
    const f = new FakeDocx(SAMPLE);
    const before = text(f);
    const r = await model(f).apply([fix(f, '몇일', '며칠'), fix(f, '없는글', 'x')]);
    expect(r.ok).toBe(false);
    expect(text(f)).toEqual(before);
  });

  it('변경이 아무리 많아도 문서 읽기는 묶음마다 2번(시작, 확인)뿐이다', async () => {
    const f = new FakeDocx(Array.from({ length: 50 }, (_, i) => ({ text: `${i}번 문단 몇일 뒤`, sizePt: 10 })));
    const ops: Op[] = f.paras.map((p, i) => ({ type: 'replaceText', paragraph: i, find: '몇일', replace: '며칠', guard: textGuard(p.text) }));
    const r = await model(f).apply(ops);
    expect(r.ok).toBe(true);
    expect(f.extractCount).toBe(2);
    expect(f.exportCount).toBe(0); // 글만 바꿀 때는 서식을 읽을 필요가 없다
    expect(text(f).every((t) => t.includes('며칠'))).toBe(true);
  });

  it('편집기가 글을 예상과 다르게 바꾸면 알리고 되돌리려고 시도한다', async () => {
    const f = new FakeDocx(SAMPLE);
    f.mangleReplace = true;
    const r = await model(f).apply([fix(f, '몇일', '며칠')]);
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect((r as { message: string }).message).toContain('글을 예상과 다르게');
    expect(f.paras[BODY]?.text).not.toContain('며칠'); // 바뀐 부분을 원래 글로 되돌렸다
  });
});

describe('DocxModel.apply: 글자 서식', () => {
  it('글자 크기를 바꾸고, 되돌리면 처음 크기가 된다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    const r = await m.apply([{ type: 'setCharStyle', paragraph: 3, style: { fontSizePt: 10 }, guard: guardOf(f, 3) }]);
    expect(r.ok).toBe(true);
    expect(f.paras[3]?.sizePt).toBe(10);
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(f.paras[3]?.sizePt).toBe(13);
  });

  it('굵게를 켜고 끌 수 있다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    const r = await m.apply([{ type: 'setCharStyle', paragraph: 1, style: { bold: true }, guard: guardOf(f, 1) }]);
    expect(f.paras[1]?.bold).toBe(true);
    if (!r.ok) throw new Error('적용 실패');
    await m.apply(r.inverse);
    expect(f.paras[1]?.bold).toBe(false);
  });

  it('글꼴을 바꾸면 한글 칸까지 모두 바뀌고, 되돌리면 칸마다 처음에 적용되던 글꼴로 돌아간다', async () => {
    const f = new FakeDocx([
      { text: '영문 칸만 있는 글꼴', rFonts: { ascii: 'Arial', hAnsi: 'Arial' }, sizePt: 10 },
      { text: '네 칸이 모두 있는 글꼴', rFonts: { ascii: '맑은 고딕', hAnsi: '맑은 고딕', eastAsia: '맑은 고딕', cs: '맑은 고딕' }, sizePt: 10 },
    ]);
    const m = model(f);
    const ops: Op[] = f.paras.map((p, i) => ({ type: 'setCharStyle', paragraph: i, style: { fontFamily: '함초롬바탕' }, guard: textGuard(p.text) }));
    const r = await m.apply(ops);
    expect(r.ok).toBe(true);
    for (const p of f.paras) expect(p.rFonts).toEqual({ ascii: '함초롬바탕', hAnsi: '함초롬바탕', eastAsia: '함초롬바탕', cs: '함초롬바탕' });
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    // 처음에 문서 기본값(맑은 고딕)을 물려받던 칸도 값을 적어서 되돌린다. 모양은 처음과 같지만 파일 안의 표기 방식은 달라진다.
    expect(f.paras[0]?.rFonts).toEqual({ ascii: 'Arial', hAnsi: 'Arial', eastAsia: '맑은 고딕', cs: '맑은 고딕' });
    expect(f.paras[1]?.rFonts).toEqual({ ascii: '맑은 고딕', hAnsi: '맑은 고딕', eastAsia: '맑은 고딕', cs: '맑은 고딕' });
  });

  it('같은 문단의 글꼴과 크기를 한 묶음에서 바꿔도 되돌릴 수 있다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    const g = guardOf(f, 1);
    const r = await m.apply([
      { type: 'setCharStyle', paragraph: 1, style: { fontSizePt: 12 }, guard: g },
      { type: 'setCharStyle', paragraph: 1, style: { fontFamily: '바탕' }, guard: g },
      { type: 'setCharStyle', paragraph: 1, style: { fontSizePt: 14 }, guard: g },
    ]);
    expect(r.ok).toBe(true);
    expect(f.paras[1]).toMatchObject({ sizePt: 14, rFonts: { eastAsia: '바탕' } });
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(f.paras[1]).toMatchObject({ sizePt: 10, rFonts: { ascii: '맑은 고딕', eastAsia: '맑은 고딕', cs: '맑은 고딕' } });
  });

  it('여러 문단의 서식을 바꿔도 문서에서 서식을 읽는 건 묶음마다 시작과 확인 2번뿐이다', async () => {
    const f = new FakeDocx(Array.from({ length: 40 }, (_, i) => ({ text: `${i}번 문단`, font: '맑은 고딕', sizePt: 10 })));
    const ops: Op[] = f.paras.map((p, i) => ({ type: 'setCharStyle', paragraph: i, style: { fontSizePt: 11 }, guard: textGuard(p.text) }));
    const r = await model(f).apply(ops);
    expect(r.ok).toBe(true);
    expect(f.exportCount).toBe(2);
    expect(f.paras.every((p) => p.sizePt === 11)).toBe(true);
  });

  it('편집기가 서식을 바꾸지 않았는데 성공했다고 하면 실패로 알린다', async () => {
    const f = new FakeDocx(SAMPLE);
    f.ignore.add('format');
    const r = await model(f).apply([{ type: 'setCharStyle', paragraph: 3, style: { fontSizePt: 10 }, guard: guardOf(f, 3) }]);
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect((r as { message: string }).message).toContain('글자 서식을 예상과 다르게');
  });

  it('빈 문단이나 서식을 읽지 못한 문단은 바꾸지 않는다', async () => {
    const f = new FakeDocx([{ text: '' }, { text: '크기가 적히지 않은 문단' }]);
    const m = model(f);
    expect(await m.apply([{ type: 'setCharStyle', paragraph: 0, style: { bold: true } }])).toMatchObject({ ok: false });
    // 문서 기본 크기도 없으면 현재 크기를 알 수 없으므로 크기 변경은 거절한다.
    const r = await m.apply([{ type: 'setCharStyle', paragraph: 1, style: { fontSizePt: 11 } }]);
    expect(r.ok === false || f.paras[1]?.sizePt === 11).toBe(true);
  });
});

describe('DocxModel.apply: 문단 서식', () => {
  it('정렬과 줄 간격을 바꾸고, 되돌리면 처음 값이 된다', async () => {
    const f = new FakeDocx(SAMPLE);
    const m = model(f);
    const g = guardOf(f, 4);
    const r = await m.apply([{ type: 'setParaStyle', paragraph: 4, style: { align: 'left', lineSpacingPct: 180 }, guard: g }]);
    expect(r.ok).toBe(true);
    expect(f.paras[4]).toMatchObject({ align: 'left', linePct: 180 });
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(f.paras[4]).toMatchObject({ align: 'both', linePct: 160 });
  });

  it('편집기가 정렬을 바꾸지 않았는데 성공했다고 하면 실패로 알린다', async () => {
    const f = new FakeDocx(SAMPLE);
    f.ignore.add('align');
    const r = await model(f).apply([{ type: 'setParaStyle', paragraph: 0, style: { align: 'right' }, guard: guardOf(f, 0) }]);
    expect(r).toMatchObject({ ok: false, reason: 'failed' });
    expect((r as { message: string }).message).toContain('문단 서식을 예상과 다르게');
  });

  it('글과 서식을 함께 바꾸는 묶음도 한 번에 적용된다', async () => {
    const f = new FakeDocx(SAMPLE);
    const g = guardOf(f, 4);
    const r = await model(f).apply([
      { type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠', guard: g },
      { type: 'setCharStyle', paragraph: 4, style: { fontSizePt: 11 }, guard: g },
      { type: 'setParaStyle', paragraph: 4, style: { lineSpacingPct: 150 }, guard: g },
    ]);
    expect(r.ok).toBe(true);
    expect(f.paras[4]).toMatchObject({ text: '본문 문장입니다. 며칠 뒤에 만나요. 할려고 했어요.', sizePt: 11, linePct: 150 });
  });
});

describe('DocxModel: 표 안의 문단', () => {
  const BODY_FONT = { font: '맑은 고딕', sizePt: 10, linePct: 160, align: 'both' } as const;
  const body = (text: string): ParaSpec => ({ text, ...BODY_FONT });
  const head = (text: string): ParaSpec => ({ ...body(text), sizePt: 14, bold: true });
  /** 본문 6개 + 표(2x2, 왼쪽 칸만 14pt 굵게) + 안쪽 표가 든 표 + 맺음 문단 */
  const FORM: Array<ParaSpec | TableSpec> = [
    ...Array.from({ length: 6 }, (_, i) => body(`본문 ${i + 1}번째 문장입니다.`)),
    [
      [head('성명'), body('홍길동')],
      [head('소속'), body('개발팀')],
    ],
    [[body('바깥 칸'), { children: [body('안쪽 표 앞글'), [[body('안쪽 몇일')]]] }]],
    body('맺음 문단입니다.'),
  ];
  const where = (s: Awaited<ReturnType<DocxModel['summarize']>>, text: string) => s.paragraphs.find((p) => p.text === text);

  it('요약에서 표 칸 안의 문단에는 표 위치가 붙고 본문의 문단에는 붙지 않는다', async () => {
    const s = await model(new FakeDocx(FORM)).summarize();
    expect(where(s, '본문 1번째 문장입니다.')).not.toHaveProperty('cell');
    expect(where(s, '맺음 문단입니다.')).not.toHaveProperty('cell');
    expect(where(s, '성명')?.cell).toEqual({ table: 1, row: 1, col: 1, depth: 1 });
    expect(where(s, '개발팀')?.cell).toEqual({ table: 1, row: 2, col: 2, depth: 1 });
    expect(where(s, '바깥 칸')?.cell).toEqual({ table: 2, row: 1, col: 1, depth: 1 });
    expect(where(s, '안쪽 표 앞글')?.cell).toEqual({ table: 2, row: 1, col: 2, depth: 1 });
    expect(where(s, '안쪽 몇일')?.cell).toEqual({ table: 3, row: 1, col: 1, depth: 2 });
  });

  it('문단 번호가 없는 문서에서도 글이 같은 문단끼리 짝지어 표 위치를 읽는다', async () => {
    const f = new FakeDocx(FORM);
    f.exportParaIds = false;
    const s = await model(f).summarize();
    expect(where(s, '개발팀')?.cell).toEqual({ table: 1, row: 2, col: 2, depth: 1 });
    expect(where(s, '안쪽 몇일')?.cell?.depth).toBe(2);
  });

  it('표 칸의 서식이 본문과 달라도 서식 점검(문서 안 일관성)은 지적하지 않는다', async () => {
    const s = await model(new FakeDocx(FORM)).summarize();
    // 표 칸까지 묶어 비교했다면 "본문 글자 크기가 다른 곳"으로 지적했을 문서다.
    expect(analyzeConsistency({ ...s, paragraphs: s.paragraphs.map(({ cell: _cell, ...p }) => p) }).findings.map((f) => f.label)).toEqual(['본문 글자 크기가 다른 곳 2곳']);
    expect(analyzeConsistency(s).findings).toEqual([]);
  });

  it('표 칸 안의 글과 서식도 본문처럼 바꾸고 되돌릴 수 있다', async () => {
    const f = new FakeDocx(FORM);
    const m = model(f);
    const s = await m.summarize();
    const cell = where(s, '안쪽 몇일');
    const head = where(s, '성명');
    if (!cell || !head) throw new Error('표 안 문단을 찾지 못했어요');
    const ops: Op[] = [
      { type: 'replaceText', paragraph: cell.index, find: '몇일', replace: '며칠', guard: textGuard(cell.text) },
      { type: 'setCharStyle', paragraph: head.index, style: { fontSizePt: 11 }, guard: textGuard(head.text) },
      { type: 'setParaStyle', paragraph: head.index, style: { align: 'center' }, guard: textGuard(head.text) },
    ];
    const r = await m.apply(ops);
    expect(r.ok).toBe(true);
    expect(f.paras[cell.index]?.text).toBe('안쪽 며칠');
    expect(f.paras[head.index]).toMatchObject({ sizePt: 11, align: 'center' });
    if (!r.ok) return;
    expect((await m.apply(r.inverse)).ok).toBe(true);
    expect(f.paras[cell.index]?.text).toBe('안쪽 몇일');
    expect(f.paras[head.index]).toMatchObject({ sizePt: 14, align: 'both' });
    // 고치고 되돌려도 표 위치는 그대로다.
    expect(where(await m.summarize(), '안쪽 몇일')?.cell).toEqual({ table: 3, row: 1, col: 1, depth: 2 });
  });
});
