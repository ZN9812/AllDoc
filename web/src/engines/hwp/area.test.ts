// @vitest-environment node
// 머리말·꼬리말·각주·미주 안의 글을 읽고 고치는 시험. 코어가 만든 문서를 파일로 내보냈다가 다시 열어 쓰므로 실제 파일을 여는 것과 같은 경로를 탄다.
import { textGuard, type DocSummary, type Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { HwpModel, type HwpFormat } from './model';
import { loadNodeCore, openAreaSample, type AreaSampleSpec } from './testing';

// 슬롯 순서: 0 머리말, 1 본문 첫 문단, 2 그 문단의 각주, 3 본문 둘째 문단, 4 그 문단의 미주, 5·6 꼬리말 두 줄
const SPEC: AreaSampleSpec = {
  body: ['첫 본문 문단 몇일 뒤', '둘째 본문 문단'],
  headers: [{ lines: ['머리말 오랫만 입니다'] }],
  footers: [{ lines: ['꼬리말 할려고 합니다', '둘째 꼬리말 줄'] }],
  notes: [
    { para: 0, at: 5, lines: ['각주 되요 입니다'] },
    { kind: 'endnote', para: 1, at: 2, lines: ['미주 설명 글'] },
  ],
};

const byText = (s: DocSummary, text: string) => s.paragraphs.find((p) => p.text === text);
const indexOf = (model: HwpModel, text: string): number => {
  const p = model.summarize().paragraphs.find((x) => x.text === text);
  if (!p) throw new Error(`문단을 찾지 못했어요: ${text}`);
  return p.index;
};
const texts = (s: DocSummary) => s.paragraphs.map((p) => p.text);

describe('머리말·꼬리말·각주·미주 문단 읽기', () => {
  it('머리말이 맨 앞, 꼬리말이 맨 끝에 오고, 각주·미주는 그것을 단 본문 문단 바로 뒤에 온다', () => {
    const { model } = openAreaSample(SPEC);
    const s = model.summarize();
    expect(s.paragraphs.map((p) => [p.index, p.text])).toEqual([
      [0, '머리말 오랫만 입니다'],
      [1, '첫 본문 문단 몇일 뒤'],
      [2, ' 각주 되요 입니다'], // 각주 번호 자리(맨 앞 글자)는 빼고 읽는다. 남은 맨 앞 공백은 번호 뒤 공백이다.
      [3, '둘째 본문 문단'],
      [4, ' 미주 설명 글'],
      [5, '꼬리말 할려고 합니다'],
      [6, '둘째 꼬리말 줄'],
    ]);
  });

  it('문단마다 어느 영역인지(머리말·꼬리말·각주·미주와 번호)를 알려 주고, 본문에는 붙이지 않는다', () => {
    const s = openAreaSample(SPEC).model.summarize();
    expect(byText(s, '머리말 오랫만 입니다')?.area).toEqual({ kind: 'header', pages: 'both' });
    expect(byText(s, '꼬리말 할려고 합니다')?.area).toEqual({ kind: 'footer', pages: 'both' });
    expect(byText(s, ' 각주 되요 입니다')?.area).toEqual({ kind: 'footnote', number: 1 });
    expect(byText(s, ' 미주 설명 글')?.area).toEqual({ kind: 'endnote', number: 1 });
    expect(byText(s, '첫 본문 문단 몇일 뒤')).not.toHaveProperty('area');
    expect(byText(s, '첫 본문 문단 몇일 뒤')).not.toHaveProperty('cell');
  });

  it('머리말·꼬리말 문단은 글자·문단 서식을 읽고, 각주·미주는 문단 서식만 읽는다(코어가 글자 서식을 주지 않는다)', () => {
    const s = openAreaSample(SPEC).model.summarize();
    const header = byText(s, '머리말 오랫만 입니다');
    expect(header?.char.fontSizePt).toBe(10);
    expect(header?.char.fontFamily).toBeTruthy();
    expect(header?.para.align).toBeDefined();
    const note = byText(s, ' 각주 되요 입니다');
    expect(note?.char).toEqual({});
    expect(note?.para.lineSpacingPct).toBeGreaterThan(0);
  });

  it('머리말·꼬리말·각주가 없는 문서는 번호가 본문 문단 번호와 같다(예전과 같다)', () => {
    const { model } = openAreaSample({ body: ['가', '나', '다'] });
    expect(model.summarize().paragraphs.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(model.describeStructure()).toMatchObject({ bodyParagraphs: 3, headerFooterParagraphs: 0, noteParagraphs: 0, unreadableNotes: 0 });
  });

  it('구조 크기를 센다', () => {
    expect(openAreaSample(SPEC).model.describeStructure()).toMatchObject({ bodyParagraphs: 2, cellParagraphs: 0, headerFooterParagraphs: 3, noteParagraphs: 2, unreadableNotes: 0 });
  });

  it('홀수 쪽·짝수 쪽 머리말은 쪽 범위가 구분되고, 같은 구역에서는 양쪽, 홀수 쪽, 짝수 쪽 순서로 센다', () => {
    const { model } = openAreaSample({
      body: ['본문'],
      headers: [{ applyTo: 1, lines: ['짝수 쪽 머리말'] }, { applyTo: 2, lines: ['홀수 쪽 머리말'] }, { lines: ['양쪽 머리말'] }],
    });
    const s = model.summarize();
    expect(s.paragraphs.map((p) => [p.text, p.area?.pages ?? null])).toEqual([
      ['양쪽 머리말', 'both'],
      ['홀수 쪽 머리말', 'odd'],
      ['짝수 쪽 머리말', 'even'],
      ['본문', null],
    ]);
  });

  it('한 각주에 문단이 여럿이면 문단마다 칸이 있고, 번호 자리는 첫 문단에만 있다', () => {
    const { model } = openAreaSample({ body: ['본문 문장'], notes: [{ para: 0, at: 2, lines: ['각주 첫 줄', '각주 둘째 줄'] }] });
    expect(texts(model.summarize())).toEqual(['본문 문장', ' 각주 첫 줄', '각주 둘째 줄']);
  });

  it('내보냈다 다시 열어도(HWP, HWPX) 같은 문단들이 읽힌다', () => {
    for (const format of ['hwp', 'hwpx'] as const) {
      const { model } = openAreaSample(SPEC, format);
      expect(texts(model.summarize()), format).toEqual(['머리말 오랫만 입니다', '첫 본문 문단 몇일 뒤', ' 각주 되요 입니다', '둘째 본문 문단', ' 미주 설명 글', '꼬리말 할려고 합니다', '둘째 꼬리말 줄']);
    }
  });

  it('쪽 번호 같은 자동 항목만 든 머리말·꼬리말 문단은 읽을 글이 없어 건너뛴다', () => {
    const { model } = openAreaSample(
      { body: ['본문'], footers: [{ lines: ['쪽'] }] },
      'hwp',
      (d) => {
        // 코어가 쪽 번호 같은 필드를 조절 문자(U+0015 …)로 보여 주는 문단을 만든다.
        d.insertFieldInHf(0, false, 0, 0, 0, 1);
        d.deleteTextInHeaderFooter(0, false, 0, 0, 1, 1);
      },
      { reopen: false },
    );
    const raw = model.summarize().paragraphs.map((p) => p.text);
    expect(raw).toEqual(['본문']);
  });
});

describe('머리말·꼬리말·각주·미주 글 바꾸기', () => {
  const fix = (model: HwpModel, text: string, find: string, replace: string): Op => ({ type: 'replaceText', paragraph: indexOf(model, text), find, replace, guard: textGuard(text) });

  it('머리말·꼬리말·각주·미주의 글을 바꾸고, 역변경으로 정확히 되돌린다', async () => {
    const { model } = openAreaSample(SPEC);
    const before = model.summarize();
    const ops = [
      fix(model, '머리말 오랫만 입니다', '오랫만', '오랜만'),
      fix(model, '꼬리말 할려고 합니다', '할려고', '하려고'),
      fix(model, ' 각주 되요 입니다', '되요', '돼요'),
      fix(model, ' 미주 설명 글', '설명', '해설'),
      fix(model, '첫 본문 문단 몇일 뒤', '몇일', '며칠'),
    ];
    const r = await model.apply(ops);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(texts(model.summarize())).toEqual(['머리말 오랜만 입니다', '첫 본문 문단 며칠 뒤', ' 각주 돼요 입니다', '둘째 본문 문단', ' 미주 해설 글', '꼬리말 하려고 합니다', '둘째 꼬리말 줄']);

    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });

  it('고친 내용이 파일에 담기고 다시 열면 같다(HWP, HWPX)', async () => {
    for (const format of ['hwp', 'hwpx'] as const) {
      const { model } = openAreaSample(SPEC, format);
      const r = await model.apply([fix(model, '머리말 오랫만 입니다', '오랫만', '오랜만'), fix(model, ' 각주 되요 입니다', '되요', '돼요'), fix(model, '둘째 꼬리말 줄', '둘째', '두 번째')]);
      expect(r.ok, format).toBe(true);
      const out = model.exportBytes();
      expect(out.lossCount, format).toBe(0);
      const Doc = (await import('./testing')).loadNodeCore();
      const reopened = new HwpModel(new Doc(out.bytes), format).summarize();
      expect(texts(reopened), format).toEqual(['머리말 오랜만 입니다', '첫 본문 문단 몇일 뒤', ' 각주 돼요 입니다', '둘째 본문 문단', ' 미주 설명 글', '꼬리말 할려고 합니다', '두 번째 꼬리말 줄']);
    }
  });

  it('머리말·꼬리말에서 글자 모양이 다른 낱말을 바꿔도 새 글이 옛 글의 서식을 이어받고, 되돌리면 서식 번호까지 같다', async () => {
    // "AAAA BBBB CCCC": BBBB 는 굵게, CCCC 는 20pt 로 만든다.
    const { model, doc } = openAreaSample({
      body: ['본문'],
      headers: [{ lines: ['AAAA BBBB CCCC'], format: [{ start: 5, end: 9, props: { bold: true } }, { start: 10, end: 14, props: { fontSize: 2000 } }] }],
    });
    const shapes = (): number[] => Array.from({ length: [...(JSON.parse(doc.getHeaderFooterParaInfo(0, true, 0, 0)) as { text: string }).text].length }, (_, o) => (JSON.parse(doc.getCharPropertiesInHeaderFooter(0, true, 0, 0, o)) as { charShapeId: number }).charShapeId);
    const before = shapes();
    expect(new Set(before).size).toBe(3); // 보통, 굵게, 20pt

    // 같은 문단을 두 번 고친다(둘째 변경의 지문은 첫 변경을 마친 글 기준이다).
    const i = indexOf(model, 'AAAA BBBB CCCC');
    const r = await model.apply([
      { type: 'replaceText', paragraph: i, find: 'BBBB', replace: 'XY', guard: textGuard('AAAA BBBB CCCC') },
      { type: 'replaceText', paragraph: i, find: 'CCCC', replace: '한글', guard: textGuard('AAAA XY CCCC') },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = shapes();
    expect(texts(model.summarize())[0]).toBe('AAAA XY 한글');
    expect(after[5]).toBe(before[5]); // XY 는 BBBB 의 굵은 서식
    expect(after[6]).toBe(before[5]);
    expect(after[8]).toBe(before[10]); // 한글 은 CCCC 의 20pt 서식
    expect(after[9]).toBe(before[10]);

    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(texts(model.summarize())[0]).toBe('AAAA BBBB CCCC');
    expect(shapes()).toEqual(before);
  });

  it('여러 글자 범위를 걸쳐 바꿔도 서식이 첫 글자를 따르고, 맨 앞·맨 뒤 글, 지우기와 끼워 넣기도 된다', async () => {
    const { model } = openAreaSample({ body: ['본문'], headers: [{ lines: ['가나다 라마바 사아자'] }] });
    const header = () => texts(model.summarize())[0];
    const op = (find: string, replace: string, at?: number): Op => ({ type: 'replaceText', paragraph: 0, find, replace, ...(at !== undefined ? { at } : {}), guard: textGuard(header() as string) });
    expect((await model.apply([op('가나다', '하나')])).ok).toBe(true);
    expect(header()).toBe('하나 라마바 사아자');
    expect((await model.apply([op('사아자', '끝')])).ok).toBe(true);
    expect(header()).toBe('하나 라마바 끝');
    expect((await model.apply([op(' 라마바', '')])).ok).toBe(true); // 지우기
    expect(header()).toBe('하나 끝');
    expect((await model.apply([op('', '[삽입]', 2)])).ok).toBe(true); // 끼워 넣기
    expect(header()).toBe('하나[삽입] 끝');
  });

  it('글자가 두 칸(UTF-16)을 차지하는 문자가 앞에 있어도 위치가 맞다', async () => {
    const { model } = openAreaSample({ body: ['본문'], headers: [{ lines: ['𠮷𠮷 몇일 뒤'] }], notes: [{ para: 0, at: 1, lines: ['𠮷 각주 몇일'] }] });
    const r = await model.apply([fix(model, '𠮷𠮷 몇일 뒤', '몇일', '며칠'), fix(model, ' 𠮷 각주 몇일', '몇일', '며칠')]);
    expect(r.ok).toBe(true);
    expect(texts(model.summarize())).toEqual(['𠮷𠮷 며칠 뒤', '본문', ' 𠮷 각주 며칠']);
  });

  it('각주 번호 자리는 건드리지 않는다: 읽는 글의 맨 앞 공백(번호 뒤 공백)까지 바꿔도 번호와 번호 자리 글자가 그대로다', async () => {
    const { model, doc } = openAreaSample(SPEC);
    // 본문에 단 각주 하나뿐인 문서라서 첫 각주 컨트롤이 곧 그 각주다.
    const control = (JSON.parse(doc.getControls()) as Array<{ ctrlId: string; para: number; controlIndex: number }>).find((c) => c.ctrlId === 'fn');
    if (!control) throw new Error('각주를 찾지 못했어요');
    const read = () => JSON.parse(doc.getFootnoteInfo(0, control.para, control.controlIndex)) as { number: number; texts: string[] };
    const before = read();
    const r = await model.apply([{ type: 'replaceText', paragraph: indexOf(model, ' 각주 되요 입니다'), find: ' 각주', replace: '각주', guard: textGuard(' 각주 되요 입니다') }]);
    expect(r.ok).toBe(true);
    const after = read();
    expect(after.number).toBe(before.number);
    expect([...(after.texts[0] as string)][0]).toBe([...(before.texts[0] as string)][0]); // 번호 자리 글자
    expect((after.texts[0] as string).slice(1)).toBe('각주 되요 입니다');
    expect(texts(model.summarize())).toContain('각주 되요 입니다');
  });

  it('쪽 번호 같은 자동 항목이 든 글을 바꾸거나 그런 글자를 넣는 변경은 이유와 함께 거절한다', async () => {
    const { model } = openAreaSample(SPEC);
    const i = indexOf(model, '머리말 오랫만 입니다');
    for (const [find, replace] of [
      ['\u0015', 'x'],
      ['오랫만', '오\u0016랜만'],
    ] as const) {
      const r = await model.apply([{ type: 'replaceText', paragraph: i, find, replace }]);
      expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
    }
  });

  it('문서가 바뀌어 지문이 다르면 거절하고 문서를 건드리지 않는다', async () => {
    const { model } = openAreaSample(SPEC);
    const before = model.summarize();
    const i = indexOf(model, '머리말 오랫만 입니다');
    const r = await model.apply([{ type: 'replaceText', paragraph: i, find: '오랫만', replace: '오랜만', guard: textGuard('다른 글') }]);
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect(model.summarize()).toEqual(before);
  });

  it('묶음 중간에 실패하면 머리말·각주를 고친 것까지 모두 되돌린다', async () => {
    const { model } = openAreaSample(SPEC);
    const before = model.summarize();
    const r = await model.apply([fix(model, '머리말 오랫만 입니다', '오랫만', '오랜만'), fix(model, ' 각주 되요 입니다', '되요', '돼요'), fix(model, '둘째 꼬리말 줄', '없는글', 'x')]);
    expect(r.ok).toBe(false);
    expect(model.summarize()).toEqual(before);
  });
});

describe('머리말·꼬리말·각주 서식 바꾸기', () => {
  it('머리말·꼬리말의 글자 서식(크기·굵게·글꼴)을 바꾸고 되돌린다', async () => {
    const { model } = openAreaSample(SPEC);
    const before = model.summarize();
    const h = indexOf(model, '머리말 오랫만 입니다');
    const f = indexOf(model, '둘째 꼬리말 줄');
    const r = await model.apply([
      { type: 'setCharStyle', paragraph: h, style: { fontSizePt: 12, bold: true } },
      { type: 'setCharStyle', paragraph: f, style: { fontFamily: '맑은 고딕' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mid = model.summarize();
    expect(byText(mid, '머리말 오랫만 입니다')?.char).toMatchObject({ fontSizePt: 12, bold: true });
    expect(byText(mid, '둘째 꼬리말 줄')?.char.fontFamily).toBe('맑은 고딕');
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });

  it('머리말·꼬리말·각주·미주의 문단 서식(정렬·줄 간격)을 바꾸고 되돌린다', async () => {
    const { model } = openAreaSample(SPEC);
    const before = model.summarize();
    const targets = ['머리말 오랫만 입니다', ' 각주 되요 입니다', ' 미주 설명 글', '꼬리말 할려고 합니다'].map((t) => indexOf(model, t));
    const r = await model.apply(targets.map((paragraph): Op => ({ type: 'setParaStyle', paragraph, style: { align: 'center', lineSpacingPct: 180 } })));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const t of ['머리말 오랫만 입니다', ' 각주 되요 입니다', ' 미주 설명 글', '꼬리말 할려고 합니다']) {
      expect(byText(model.summarize(), t)?.para, t).toMatchObject({ align: 'center', lineSpacingPct: 180 });
    }
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });

  it('각주·미주 안 글의 글자 서식은 코어가 읽고 쓰는 길이 없어서 바꾸지 않고 이유를 알린다', async () => {
    const { model } = openAreaSample(SPEC);
    const before = model.summarize();
    const r = await model.apply([{ type: 'setCharStyle', paragraph: indexOf(model, ' 각주 되요 입니다'), style: { bold: true } }]);
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
    if (!r.ok) expect(r.message).toContain('각주·미주');
    expect(model.summarize()).toEqual(before);
  });
});

describe('편집기로 이동할 위치', () => {
  it('머리말·꼬리말은 그것을 정의한 본문 문단으로, 각주·미주는 그것을 단 본문 문단으로 안내하고 영역 정보를 함께 준다', () => {
    const { model } = openAreaSample(SPEC);
    expect(model.paragraphTarget(indexOf(model, '첫 본문 문단 몇일 뒤'))).toMatchObject({ section: 0, paragraph: 0, inTable: false });
    expect(model.paragraphTarget(indexOf(model, '첫 본문 문단 몇일 뒤'))).not.toHaveProperty('area');
    // 각주는 본문 첫 문단(0)에, 미주는 둘째 문단(1)에 달려 있다.
    expect(model.paragraphTarget(indexOf(model, ' 각주 되요 입니다'))).toMatchObject({ section: 0, paragraph: 0, inTable: false, area: { kind: 'footnote', number: 1 } });
    expect(model.paragraphTarget(indexOf(model, ' 미주 설명 글'))).toMatchObject({ section: 0, paragraph: 1, area: { kind: 'endnote' } });
    expect(model.paragraphTarget(indexOf(model, '머리말 오랫만 입니다'))).toMatchObject({ area: { kind: 'header' } });
    expect(model.paragraphTarget(indexOf(model, '둘째 꼬리말 줄'))).toMatchObject({ area: { kind: 'footer' } });
  });

  it('표 칸으로 이동하는 위치는 표 안의 문단에만 있다', () => {
    const { model } = openAreaSample(SPEC);
    for (const t of ['머리말 오랫만 입니다', ' 각주 되요 입니다', '꼬리말 할려고 합니다']) expect(model.cellFocus(indexOf(model, t))).toBeNull();
  });
});

// 코어의 각주 정보(getFootnoteInfo)는 글 속의 탭을 이스케이프하지 않은 깨진 JSON 으로 돌려준다. 예전에는 그런 각주·미주를 읽지 못했다
// (실제 예제 문서에서 확인했다: 3-09월_교육_통합_2023.hwp 는 미주 46개 중 42개가 그랬다).
describe('글에 탭이 든 각주·미주', () => {
  const FORMATS: HwpFormat[] = ['hwp', 'hwpx'];
  const noteControl = (doc: ReturnType<typeof openAreaSample>['doc']) => {
    const note = (JSON.parse(doc.getControls()) as Array<{ ctrlId: string; list: number; para: number; controlIndex: number }>).find((c) => c.ctrlId.trim() === 'fn' && c.list === 0);
    if (!note) throw new Error('각주를 찾지 못했어요');
    return note;
  };
  const open = (format: HwpFormat) =>
    openAreaSample({ body: ['본문 문장 몇일'], notes: [{ para: 0, at: 2, lines: ['각주 몇일'] }] }, format, (built) => {
      // 첫 문단 끝(번호 자리 2글자 + 글)에 탭과 글을 덧붙인다.
      built.insertTextInFootnote(0, 0, noteControl(built).controlIndex, 0, 2 + [...'각주 몇일'].length, '\t되요');
    });

  it.each(FORMATS)('%s: 읽는다(읽지 못한 각주로 세지 않는다)', (format) => {
    const { doc, model } = open(format);
    const note = noteControl(doc);
    // 시험 전제: 코어가 이 각주의 정보를 깨진 JSON 으로 돌려준다.
    expect(() => JSON.parse(doc.getFootnoteInfo(0, note.para, note.controlIndex))).toThrow();
    expect(model.describeStructure()).toMatchObject({ noteParagraphs: 1, unreadableNotes: 0 });
    expect(texts(model.summarize())).toEqual(['본문 문장 몇일', ' 각주 몇일\t되요']);
  });

  it.each(FORMATS)('%s: 글을 바꾸고 되돌리고, 내보냈다 다시 열어도 같다(탭이 그대로 남는다)', async (format) => {
    const { model } = open(format);
    const fix = (text: string, find: string, replace: string): Op => ({ type: 'replaceText', paragraph: indexOf(model, text), find, replace, guard: textGuard(text) });
    const before = model.summarize();

    const first = await model.apply([fix(' 각주 몇일\t되요', '되요', '돼요')]);
    expect(first, JSON.stringify(first)).toMatchObject({ ok: true });
    expect(texts(model.summarize())).toEqual(['본문 문장 몇일', ' 각주 몇일\t돼요']);
    const second = await model.apply([fix(' 각주 몇일\t돼요', '몇일', '며칠')]); // 탭 앞의 글도 고친다
    expect(second, JSON.stringify(second)).toMatchObject({ ok: true });
    expect(texts(model.summarize())).toEqual(['본문 문장 몇일', ' 각주 며칠\t돼요']);

    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    const Doc = loadNodeCore();
    expect(texts(new HwpModel(new Doc(out.bytes), format).summarize())).toEqual(['본문 문장 몇일', ' 각주 며칠\t돼요']);

    if (!first.ok || !second.ok) return;
    expect((await model.apply(second.inverse)).ok).toBe(true);
    expect((await model.apply(first.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });
});
