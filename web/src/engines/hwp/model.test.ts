// @vitest-environment node
import { textGuard, type DocSummary, type Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { codePointLength, HwpModel } from './model';
import { loadNodeCore, openSample } from './testing';

const LINES = ['업무 협조 요청', '1. 첫째 항목입니다', '2. 둘째 항목입니다', '', '본문 문장입니다. 몇일 뒤에 만나요.'];

const char = (model: HwpModel, i: number) => model.summarize().paragraphs.find((p) => p.index === i)?.char;
const para = (model: HwpModel, i: number) => model.summarize().paragraphs.find((p) => p.index === i)?.para;
const texts = (s: DocSummary) => s.paragraphs.map((p) => p.text);

describe('한글 문서 요약', () => {
  it('글이 있는 문단만, 문서 기준 번호와 글꼴·크기·정렬·줄 간격을 담는다', () => {
    const { model } = openSample(LINES);
    const s = model.summarize();
    expect(s.kind).toBe('hwp');
    expect(s.paragraphs.map((p) => p.index)).toEqual([0, 1, 2, 4]); // 빈 문단(3)은 번호만 건너뛴다
    expect(texts(s)).toEqual(['업무 협조 요청', '1. 첫째 항목입니다', '2. 둘째 항목입니다', '본문 문장입니다. 몇일 뒤에 만나요.']);
    expect(s.paragraphs[0]).toMatchObject({ char: { fontFamily: '함초롬바탕', fontSizePt: 10 }, para: { align: 'justify', lineSpacingPct: 160 } });
    expect(s.pageCount).toBeGreaterThanOrEqual(1);
  });

  it('HWPX 도 같은 방식으로 읽는다', () => {
    const { model } = openSample(LINES, 'hwpx');
    expect(model.summarize().kind).toBe('hwpx');
    expect(model.summarize().paragraphs).toHaveLength(4);
  });
});

describe('글 바꾸기', () => {
  it('글을 바꾸고, 역변경으로 정확히 되돌린다(서식은 그대로)', async () => {
    const { model } = openSample(LINES);
    const before = model.summarize();
    const r = await model.apply([{ type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(model.summarize().paragraphs.at(-1)?.text).toBe('본문 문장입니다. 며칠 뒤에 만나요.');
    expect(model.summarize().paragraphs.at(-1)?.char).toEqual(before.paragraphs.at(-1)?.char);
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });

  it('같은 글이 여러 번 나와도 바꾼 자리에서 되돌린다', async () => {
    const { model } = openSample(['가나 가나 가나']);
    const r = await model.apply([{ type: 'replaceText', paragraph: 0, find: '가나', replace: '가 나', at: 3 }]);
    expect(r.ok && texts(model.summarize())[0]).toBe('가나 가 나 가나');
    if (r.ok) {
      await model.apply(r.inverse);
      expect(texts(model.summarize())[0]).toBe('가나 가나 가나');
    }
  });

  it('이모지처럼 글자 하나가 두 칸을 차지하는 글자가 앞에 있어도 위치를 맞춘다', async () => {
    const line = '😀😀 몇일 😀 몇일';
    const { model } = openSample([line]);
    expect(codePointLength(line)).toBe(line.length - 3); // 자바스크립트 길이와 코어의 글자 수가 다르다
    const r = await model.apply([{ type: 'replaceText', paragraph: 0, find: '몇일', replace: '며칠', at: line.lastIndexOf('몇일') }]);
    expect(r.ok).toBe(true);
    expect(texts(model.summarize())[0]).toBe('😀😀 몇일 😀 며칠');
  });

  it('글을 지웠다가 되돌리면 원래대로(지우기는 빈 글로 바꾸기)', async () => {
    const { model } = openSample(['안녕하세요 여러분']);
    const r = await model.apply([{ type: 'replaceText', paragraph: 0, find: ' 여러분', replace: '' }]);
    expect(texts(model.summarize())[0]).toBe('안녕하세요');
    if (r.ok) {
      expect((await model.apply(r.inverse)).ok).toBe(true);
      expect(texts(model.summarize())[0]).toBe('안녕하세요 여러분');
    }
  });

  it('고칠 글이 없거나 문단이 없으면 stale, 줄바꿈이 들어간 변경은 지원하지 않는다', async () => {
    const { model } = openSample(LINES);
    expect(await model.apply([{ type: 'replaceText', paragraph: 4, find: '없는글', replace: 'x' }])).toMatchObject({ ok: false, reason: 'stale' });
    expect(await model.apply([{ type: 'replaceText', paragraph: 99, find: 'a', replace: 'b' }])).toMatchObject({ ok: false, reason: 'stale' });
    expect(await model.apply([{ type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠\n뒤' }])).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});

describe('문서가 바뀐 뒤의 제안(지문 확인)', () => {
  it('제안을 만들 때 본 글과 지금 글이 다르면 적용하지 않는다', async () => {
    const { model } = openSample(LINES);
    const guard = textGuard('본문 문장입니다. 몇일 뒤에 만나요.');
    const stale = await model.apply([{ type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠', guard: textGuard('다른 글') }]);
    expect(stale).toMatchObject({ ok: false, reason: 'stale' });
    expect(texts(model.summarize()).at(-1)).toBe('본문 문장입니다. 몇일 뒤에 만나요.');
    expect((await model.apply([{ type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠', guard }])).ok).toBe(true);
  });

  it('서식 변경에도 지문을 확인한다(문단이 밀렸을 때 엉뚱한 문단이 바뀌지 않게)', async () => {
    const { model } = openSample(LINES);
    const r = await model.apply([{ type: 'setCharStyle', paragraph: 1, style: { fontSizePt: 14 }, guard: textGuard('2. 둘째 항목입니다') }]);
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect(char(model, 1)?.fontSizePt).toBe(10);
  });
});

describe('글자 서식', () => {
  it('크기·굵기를 바꾸고 되돌린다(다른 문단은 그대로)', async () => {
    const { model } = openSample(LINES);
    const r = await model.apply([{ type: 'setCharStyle', paragraph: 0, style: { fontSizePt: 18, bold: true } }]);
    expect(r.ok).toBe(true);
    expect(char(model, 0)).toMatchObject({ fontSizePt: 18, bold: true });
    expect(char(model, 1)).toMatchObject({ fontSizePt: 10 });
    expect(char(model, 1)?.bold).toBeUndefined();
    if (r.ok) {
      await model.apply(r.inverse);
      expect(char(model, 0)?.fontSizePt).toBe(10);
      expect(char(model, 0)?.bold).toBeUndefined();
    }
  });

  it('글꼴을 바꾸고 되돌리면 언어별 글꼴 7칸이 그대로 돌아온다', async () => {
    const { model } = openSample(LINES, 'hwp', (d) => {
      const ids = ['굴림', '돋움', '바탕', '궁서', 'Arial', '맑은 고딕', '함초롬바탕'].map((n, i) => d.findOrCreateFontIdForLang(i, n));
      d.applyCharFormat(0, 1, 0, 30, JSON.stringify({ fontIds: ids }));
    });
    expect(char(model, 1)?.fontFamily).toBe('굴림');
    const r = await model.apply([{ type: 'setCharStyle', paragraph: 1, style: { fontFamily: '맑은 고딕' } }]);
    expect(r.ok).toBe(true);
    expect(char(model, 1)?.fontFamily).toBe('맑은 고딕');
    if (r.ok) {
      expect(r.inverse[0]).toMatchObject({ type: 'setCharStyle', style: { fontFaces: ['굴림', '돋움', '바탕', '궁서', 'Arial', '맑은 고딕', '함초롬바탕'] } });
      await model.apply(r.inverse);
      expect(char(model, 1)?.fontFamily).toBe('굴림');
    }
  });

  it('빈 문단에는 서식을 바꿀 수 없다', async () => {
    const { model } = openSample(LINES);
    expect(await model.apply([{ type: 'setCharStyle', paragraph: 3, style: { fontSizePt: 12 } }])).toMatchObject({ ok: false, reason: 'stale' });
  });
});

describe('문단 서식', () => {
  it('정렬과 줄 간격을 바꾸고 되돌린다', async () => {
    const { model } = openSample(LINES);
    const r = await model.apply([{ type: 'setParaStyle', paragraph: 0, style: { align: 'center', lineSpacingPct: 130 } }]);
    expect(r.ok).toBe(true);
    expect(para(model, 0)).toEqual({ align: 'center', lineSpacingPct: 130 });
    expect(para(model, 1)).toEqual({ align: 'justify', lineSpacingPct: 160 });
    if (r.ok) {
      await model.apply(r.inverse);
      expect(para(model, 0)).toEqual({ align: 'justify', lineSpacingPct: 160 });
    }
  });

  it('배분 정렬 같은 특수 정렬도 정확히 되돌린다', async () => {
    const { model, doc } = openSample(LINES, 'hwp', (d) => d.applyParaFormat(0, 0, JSON.stringify({ alignment: 'distribute' })));
    expect(para(model, 0)?.align).toBeUndefined(); // 4가지에 없는 값은 요약에서 빠진다
    const r = await model.apply([{ type: 'setParaStyle', paragraph: 0, style: { align: 'center' } }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      await model.apply(r.inverse);
      expect(JSON.parse(doc.getParaPropertiesAt(0, 0)).alignment).toBe('distribute');
    }
  });

  it('줄 간격이 고정값인 문단은 정확히 되돌릴 수 없어서 바꾸지 않는다', async () => {
    const { model } = openSample(LINES, 'hwp', (d) => d.applyParaFormat(0, 0, JSON.stringify({ lineSpacing: 1500, lineSpacingType: 'Fixed' })));
    expect(para(model, 0)?.lineSpacingPct).toBeUndefined();
    expect(await model.apply([{ type: 'setParaStyle', paragraph: 0, style: { lineSpacingPct: 160 } }])).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});

describe('묶음 적용', () => {
  it('하나라도 실패하면 이미 적용한 변경도 모두 되돌린다', async () => {
    const { model } = openSample(LINES);
    const before = model.summarize();
    const ops: Op[] = [
      { type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠' },
      { type: 'setCharStyle', paragraph: 0, style: { fontSizePt: 20 } },
      { type: 'replaceText', paragraph: 1, find: '없는글', replace: 'x' },
    ];
    expect(await model.apply(ops)).toMatchObject({ ok: false, reason: 'stale' });
    expect(model.summarize()).toEqual(before);
  });
});

describe('내보내기', () => {
  it('고친 내용이 파일에 담기고 다시 열면 같다(HWP, HWPX)', async () => {
    for (const format of ['hwp', 'hwpx'] as const) {
      const { model } = openSample(LINES, format);
      await model.apply([
        { type: 'replaceText', paragraph: 4, find: '몇일', replace: '며칠' },
        { type: 'setCharStyle', paragraph: 0, style: { fontSizePt: 16, bold: true } },
      ]);
      const out = model.exportBytes();
      expect(out.lossCount).toBe(0);
      expect(out.bytes.length).toBeGreaterThan(1000);
      const Doc = loadNodeCore();
      const reopened = new HwpModel(new Doc(out.bytes), format).summarize();
      expect(reopened.paragraphs.at(-1)?.text).toBe('본문 문장입니다. 며칠 뒤에 만나요.');
      expect(reopened.paragraphs[0]?.char).toMatchObject({ fontSizePt: 16, bold: true });
    }
  });
});
