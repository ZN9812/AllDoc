// @vitest-environment node
// 한글 문서의 글상자 안의 글을 읽고 고치는 시험. 코어가 만든 문서를 파일로 내보냈다가 다시 열어 쓰므로 실제 파일을 여는 것과 같은 경로를 탄다.
// 글상자가 표 칸 안·다른 글상자 안에 놓인 경우와, 글상자 안에 표가 놓인 경우도 본다.
import { textGuard, type DocSummary, type Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { HwpModel, type HwpFormat } from './model';
import { loadNodeCore, openBoxSample, type BoxSampleSpec } from './testing';

const FORMATS: HwpFormat[] = ['hwp', 'hwpx'];

// 문단 칸 순서: 0 본문 첫 문단, 1·2 글상자 1(두 문단), 3 본문 둘째 문단, 4 글상자 2(글이 없다)는 요약에 안 나옴, 5 본문 셋째 문단
const SPEC: BoxSampleSpec = {
  body: ['첫 본문 문단 몇일 뒤', '둘째 본문 문단', '셋째 본문 문단'],
  boxes: [
    { para: 0, lines: ['글상자 첫줄 할려고', '글상자 둘째줄 되요'] },
    { para: 2, lines: [] },
  ],
};

const byText = (s: DocSummary, text: string) => s.paragraphs.find((p) => p.text === text);
const indexOf = (model: HwpModel, text: string): number => {
  const p = byText(model.summarize(), text);
  if (!p) throw new Error(`문단을 찾지 못했어요: ${text}`);
  return p.index;
};
const texts = (s: DocSummary) => s.paragraphs.map((p) => p.text);
const guardOf = (model: HwpModel, text: string): string => textGuard(text) && textGuard(byText(model.summarize(), text)?.text ?? '');
const replace = (model: HwpModel, text: string, find: string, to: string): Op => ({ type: 'replaceText', paragraph: indexOf(model, text), find, replace: to, guard: guardOf(model, text) });

/** 코어를 직접 읽어 글상자 안 문단의 글을 얻는다(모델을 거치지 않는 경로) */
const rawBoxText = (doc: ReturnType<typeof openBoxSample>['doc'], para: number, control: number, q = 0): string => {
  const path = JSON.stringify([{ controlIndex: control, cellIndex: 0, cellParaIndex: q }]);
  const len = doc.getCellParagraphLengthByPath(0, para, path);
  return len > 0 ? doc.getTextInCellByPath(0, para, path, 0, len) : '';
};

describe('글상자 안의 글 읽기', () => {
  it.each(FORMATS)('%s: 글상자 안 문단은 그 글상자를 단 본문 문단 바로 뒤에 오고, 글상자 번호가 위치로 붙고, 본문에는 붙지 않는다', (format) => {
    const { model } = openBoxSample(SPEC, format);
    const s = model.summarize();
    expect(s.paragraphs.map((p) => [p.index, p.text, p.area ?? null])).toEqual([
      [0, '첫 본문 문단 몇일 뒤', null],
      [1, '글상자 첫줄 할려고', { kind: 'textbox', number: 1 }],
      [2, '글상자 둘째줄 되요', { kind: 'textbox', number: 1 }],
      [3, '둘째 본문 문단', null],
      [4, '셋째 본문 문단', null], // 그 문단에 단 글상자 2 는 글이 없어 요약에 안 나온다(빈 문단이 5번)
    ]);
    expect(byText(s, '첫 본문 문단 몇일 뒤')).not.toHaveProperty('cell');
    expect(byText(s, '글상자 첫줄 할려고')).not.toHaveProperty('cell');
  });

  it('글상자 안 문단도 글자·문단 서식을 읽는다', () => {
    const p = byText(openBoxSample(SPEC).model.summarize(), '글상자 첫줄 할려고');
    expect(p?.char.fontSizePt).toBe(10);
    expect(p?.char.fontFamily).toBeTruthy();
    expect(p?.para.align).toBeDefined();
    expect(p?.para.lineSpacingPct).toBeGreaterThan(0);
  });

  it('글이 없는 글상자도 글상자 번호를 차지한다(문서 순서로 센다)', () => {
    const { model } = openBoxSample({ body: ['가', '나', '다'], boxes: [{ para: 0, lines: [] }, { para: 1, lines: ['둘째 상자 글'] }, { para: 2, lines: ['셋째 상자 글'] }] });
    const s = model.summarize();
    expect(byText(s, '둘째 상자 글')?.area).toEqual({ kind: 'textbox', number: 2 });
    expect(byText(s, '셋째 상자 글')?.area).toEqual({ kind: 'textbox', number: 3 });
    expect(model.describeStructure()).toMatchObject({ boxes: 3, bodyBoxes: 3, boxParagraphs: 3 });
  });

  it('글상자가 없는 문서는 번호가 본문 문단 번호와 같다(예전과 같다)', () => {
    const { model } = openBoxSample({ body: ['가', '나', '다'] });
    expect(model.summarize().paragraphs.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(model.describeStructure()).toMatchObject({ bodyParagraphs: 3, boxes: 0, boxParagraphs: 0 });
  });

  it('구조 크기를 센다', () => {
    expect(openBoxSample(SPEC).model.describeStructure()).toMatchObject({ bodyParagraphs: 3, cellParagraphs: 0, tables: 0, boxes: 2, bodyBoxes: 2, boxParagraphs: 3, headerFooterParagraphs: 0, noteParagraphs: 0 });
  });

  it('글상자를 가지지 않은 도형(글이 없는 사각형)은 글상자가 아니다', () => {
    const Doc = loadNodeCore();
    const built = Doc.createEmpty();
    built.createBlankDocument();
    built.insertText(0, 0, 0, '본문 문단');
    built.createShapeControl(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0, width: 5000, height: 3000, shapeType: 'rectangle' }));
    const model = new HwpModel(new Doc(new Uint8Array(built.exportHwp())), 'hwp');
    expect(model.describeStructure()).toMatchObject({ boxes: 0, boxParagraphs: 0 });
    expect(texts(model.summarize())).toEqual(['본문 문단']);
  });

  const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

  it('글 캡션이 없는 그림은 글상자가 아니다', () => {
    const Doc = loadNodeCore();
    const built = Doc.createEmpty();
    built.createBlankDocument();
    built.insertText(0, 0, 0, '그림 위 문단');
    built.insertPicture(0, 0, 0, '', PNG, 7200, 7200, 1, 1, 'png', '시험 그림');
    const model = new HwpModel(new Doc(new Uint8Array(built.exportHwp())), 'hwp');
    expect(model.describeStructure()).toMatchObject({ boxes: 0, boxParagraphs: 0 });
    expect(texts(model.summarize())).toEqual(['그림 위 문단']);
  });

  // 글 캡션이 달린 그림은 코어의 경로 함수로는 글상자처럼 문단이 읽힌다(캡션 문단). 실제 예제 문서에서 이런 그림이 글상자로 잘못 세어졌었다.
  // 캡션의 "그림 1" 같은 글은 글상자 안의 글이 아니라서 읽지 않는다(캡션을 고치는 것은 이 시험이 다루지 않는다).
  it.each(FORMATS)('%s: 글 캡션이 달린 그림은 글상자가 아니다(본문의 그림과 표 칸 안의 그림 모두)', (format) => {
    const Doc = loadNodeCore();
    const built = Doc.createEmpty();
    built.createBlankDocument();
    built.insertText(0, 0, 0, '그림 위 문단');
    built.splitParagraph(0, 0, built.getParagraphLength(0, 0)); // 표를 놓을 빈 둘째 문단
    built.insertPicture(0, 0, 0, '', PNG, 7200, 7200, 1, 1, 'png', '본문 그림');
    built.setPictureProperties(0, 0, 2, JSON.stringify({ hasCaption: true }));
    // 둘째 문단에 표 하나를 놓고, 캡션이 달린 그림을 그 칸 문단에도 붙여 넣는다(코어에는 칸 문단 안에 그림을 바로 만드는 함수가 없다).
    const table = JSON.parse(built.createTable(0, 1, 0, 1, 1)) as { paraIdx: number; controlIdx: number };
    built.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, '칸 안 문단');
    built.copyControl(0, 0, '', 2);
    built.pasteInternalInCell(0, table.paraIdx, table.controlIdx, 0, 0, 5);

    // 시험 전제: 코어의 경로 함수로는 이 그림들이 글상자처럼 문단(캡션)을 가진다. 그래서 글상자로 세기 전에 도형인지를 따로 가려야 한다.
    const cell = { controlIndex: table.controlIdx, cellIndex: 0, cellParaIndex: 0 };
    expect(built.getCellParagraphCountByPath(0, 0, JSON.stringify([{ controlIndex: 2, cellIndex: 0, cellParaIndex: 0 }]))).toBe(1);
    expect(built.getCellParagraphCountByPath(0, table.paraIdx, JSON.stringify([cell, { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]))).toBe(1);

    const bytes = new Uint8Array(format === 'hwp' ? built.exportHwp() : built.exportHwpx());
    const model = new HwpModel(new Doc(bytes), format);
    expect(model.describeStructure()).toMatchObject({ tables: 1, boxes: 0, bodyBoxes: 0, boxParagraphs: 0 });
    const s = model.summarize();
    expect(s.paragraphs.some((p) => p.area?.kind === 'textbox')).toBe(false);
    expect(texts(s)).toEqual(['그림 위 문단', '칸 안 문단']);
  });

  // 표에도 글 캡션이 붙을 수 있다. 캡션 문단은 표 칸이 아니라서 읽지 않고, 표 칸의 글은 그대로 읽는다.
  it.each(FORMATS)('%s: 글 캡션이 달린 표는 캡션을 읽지 않고 표 칸의 글만 읽는다', (format) => {
    const Doc = loadNodeCore();
    const built = Doc.createEmpty();
    built.createBlankDocument();
    built.insertText(0, 0, 0, '표 위 문단');
    built.splitParagraph(0, 0, built.getParagraphLength(0, 0));
    const table = JSON.parse(built.createTable(0, 1, 0, 1, 1)) as { paraIdx: number; controlIdx: number };
    built.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, '칸 안 문단');
    built.setTableProperties(0, table.paraIdx, table.controlIdx, JSON.stringify({ hasCaption: true }));
    expect(JSON.parse(built.getTableProperties(0, table.paraIdx, table.controlIdx))).toMatchObject({ hasCaption: true }); // 시험 전제
    const bytes = new Uint8Array(format === 'hwp' ? built.exportHwp() : built.exportHwpx());
    const model = new HwpModel(new Doc(bytes), format);
    expect(model.describeStructure()).toMatchObject({ tables: 1, cellParagraphs: 1, boxes: 0, boxParagraphs: 0 });
    expect(texts(model.summarize())).toEqual(['표 위 문단', '칸 안 문단']);
  });
});

describe('글상자 안의 글 고치기', () => {
  it.each(FORMATS)('%s: 글을 바꾸고 내보내도 같고, 되돌리면 처음과 같다(본문과 한 묶음으로도)', async (format) => {
    const { doc, model, boxes } = openBoxSample(SPEC, format);
    const before = model.summarize();
    const first = boxes[0] as { para: number; control: number };

    const r = await model.apply([replace(model, '첫 본문 문단 몇일 뒤', '몇일', '며칠'), replace(model, '글상자 첫줄 할려고', '할려고', '하려고'), replace(model, '글상자 둘째줄 되요', '되요', '돼요')]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    // 모델을 거치지 않고 코어를 직접 읽어도 바뀌어 있다.
    expect(rawBoxText(doc, first.para, first.control, 0)).toBe('글상자 첫줄 하려고');
    expect(rawBoxText(doc, first.para, first.control, 1)).toBe('글상자 둘째줄 돼요');
    const edited = model.summarize();
    expect(texts(edited)).toEqual(['첫 본문 문단 며칠 뒤', '글상자 첫줄 하려고', '글상자 둘째줄 돼요', '둘째 본문 문단', '셋째 본문 문단']);
    expect(edited.paragraphs.map((p) => p.area ?? null)).toEqual(before.paragraphs.map((p) => p.area ?? null)); // 위치는 그대로

    // 파일로 내보내고 다시 읽어도 같다: 손실이 없고 글·위치·서식이 그대로다.
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    const Doc = loadNodeCore();
    expect(new HwpModel(new Doc(out.bytes), format).summarize().paragraphs).toEqual(edited.paragraphs);

    // 되돌리면 처음과 같다.
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it('글상자 안에서 글을 바꿔도 그 문단의 글자 서식(굵게 등)은 바꾼 글에 이어진다', async () => {
    const { model } = openBoxSample(SPEC);
    const idx = indexOf(model, '글상자 첫줄 할려고');
    const bold = await model.apply([{ type: 'setCharStyle', paragraph: idx, style: { bold: true }, guard: guardOf(model, '글상자 첫줄 할려고') }]);
    expect(bold.ok).toBe(true);
    const r = await model.apply([{ type: 'replaceText', paragraph: idx, find: '할려고', replace: '하려고', guard: guardOf(model, '글상자 첫줄 할려고') }]);
    expect(r.ok).toBe(true);
    const p = byText(model.summarize(), '글상자 첫줄 하려고');
    expect(p?.char.bold).toBe(true);
  });

  it.each(FORMATS)('%s: 글자 서식(크기·굵게·글꼴)을 바꾸고 되돌린다', async (format) => {
    const { model } = openBoxSample(SPEC, format);
    const before = model.summarize();
    const idx = indexOf(model, '글상자 첫줄 할려고');
    const guard = guardOf(model, '글상자 첫줄 할려고');
    const r = await model.apply([{ type: 'setCharStyle', paragraph: idx, style: { fontSizePt: 14, bold: true, fontFamily: '맑은 고딕' }, guard }]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    const now = byText(model.summarize(), '글상자 첫줄 할려고');
    expect(now?.char).toMatchObject({ fontSizePt: 14, bold: true, fontFamily: '맑은 고딕' });
    // 다른 문단은 그대로다.
    expect(byText(model.summarize(), '글상자 둘째줄 되요')?.char.fontSizePt).toBe(10);
    // 내보내도 같다.
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(byText(new HwpModel(new (loadNodeCore())(out.bytes), format).summarize(), '글상자 첫줄 할려고')?.char).toMatchObject({ fontSizePt: 14, bold: true });
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it.each(FORMATS)('%s: 본문에 놓인 글상자의 문단 서식(정렬·줄 간격)을 바꾸고 되돌린다', async (format) => {
    const { model } = openBoxSample(SPEC, format);
    const before = model.summarize();
    const idx = indexOf(model, '글상자 둘째줄 되요');
    const guard = guardOf(model, '글상자 둘째줄 되요');
    const r = await model.apply([{ type: 'setParaStyle', paragraph: idx, style: { align: 'center', lineSpacingPct: 130 }, guard }]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(byText(model.summarize(), '글상자 둘째줄 되요')?.para).toEqual({ align: 'center', lineSpacingPct: 130 });
    expect(byText(model.summarize(), '글상자 첫줄 할려고')?.para.align).toBe('justify'); // 같은 글상자의 다른 문단은 그대로
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(byText(new HwpModel(new (loadNodeCore())(out.bytes), format).summarize(), '글상자 둘째줄 되요')?.para).toEqual({ align: 'center', lineSpacingPct: 130 });
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it('문서가 바뀌어 지문이 맞지 않으면 글상자 안의 글은 적용하지 않고 알린다', async () => {
    const { model } = openBoxSample(SPEC);
    const idx = indexOf(model, '글상자 첫줄 할려고');
    const r = await model.apply([{ type: 'replaceText', paragraph: idx, find: '할려고', replace: '하려고', guard: textGuard('다른 글') }]);
    expect(r).toMatchObject({ ok: false, reason: 'stale' });
    expect(byText(model.summarize(), '글상자 첫줄 할려고')).toBeDefined();
  });

  it('한 묶음에서 하나라도 실패하면 글상자 안의 변경도 모두 되돌린다', async () => {
    const { model } = openBoxSample(SPEC);
    const before = model.summarize();
    const r = await model.apply([replace(model, '글상자 첫줄 할려고', '할려고', '하려고'), { type: 'replaceText', paragraph: 9999, find: 'x', replace: 'y' }]);
    expect(r.ok).toBe(false);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });
});

describe('표 칸 안·글상자 안에 놓인 글상자', () => {
  const NESTED: BoxSampleSpec = {
    body: ['첫 문단', '표가 놓일 문단', '끝 문단'],
    boxes: [{ para: 0, lines: ['바깥 글상자 글'] }],
    cellBox: { para: 1, cells: [['왼쪽 칸', '오른쪽 칸']], at: [0, 1], lines: ['표 칸 안 글상자 되요'] },
    innerBox: { outer: 0, lines: ['안쪽 글상자 할려고'] },
    innerTable: { outer: 0, cells: [['글상자 안 표 몇일']] },
  };

  it.each(FORMATS)('%s: 표 칸 안의 글상자·글상자 안의 글상자·글상자 안 표 칸의 글을 모두 읽고, 가장 안쪽 글상자 번호로 위치를 말한다', (format) => {
    const { model } = openBoxSample(NESTED, format);
    const s = model.summarize();
    const place = (text: string) => byText(s, text)?.area ?? byText(s, text)?.cell ?? null;
    expect(place('첫 문단')).toBeNull();
    expect(place('바깥 글상자 글')).toEqual({ kind: 'textbox', number: 1 });
    expect(place('안쪽 글상자 할려고')).toEqual({ kind: 'textbox', number: 2 });
    expect(place('글상자 안 표 몇일')).toEqual({ kind: 'textbox', number: 1 }); // 글상자 안에 놓인 표의 칸 문단은 글상자로 말한다
    expect(place('왼쪽 칸')).toMatchObject({ table: expect.any(Number), row: 1, col: 1 });
    expect(place('표 칸 안 글상자 되요')).toEqual({ kind: 'textbox', number: 3 }); // 표 칸 안의 글상자도 글상자 번호
    expect(byText(s, '표 칸 안 글상자 되요')).not.toHaveProperty('cell');
    const st = model.describeStructure();
    expect(st).toMatchObject({ boxes: 3, bodyBoxes: 1, tables: 2 }); // 글상자 안의 표도 표 수에 든다
  });

  it.each(FORMATS)('%s: 깊이 2 이상의 글상자 안 글도 바꾸고 글자 서식을 바꾸고 되돌리며, 내보내도 같다', async (format) => {
    const { model } = openBoxSample(NESTED, format);
    const before = model.summarize();
    const targets: Array<[string, string, string]> = [
      ['안쪽 글상자 할려고', '할려고', '하려고'],
      ['글상자 안 표 몇일', '몇일', '며칠'],
      ['표 칸 안 글상자 되요', '되요', '돼요'],
    ];
    const ops: Op[] = [
      ...targets.map(([text, find, to]) => replace(model, text, find, to)),
      { type: 'setCharStyle', paragraph: indexOf(model, '안쪽 글상자 할려고'), style: { fontSizePt: 12 }, guard: guardOf(model, '안쪽 글상자 할려고') },
    ];
    const r = await model.apply(ops);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    const edited = model.summarize();
    expect(texts(edited)).toEqual(expect.arrayContaining(['안쪽 글상자 하려고', '글상자 안 표 며칠', '표 칸 안 글상자 돼요']));
    expect(byText(edited, '안쪽 글상자 하려고')?.char.fontSizePt).toBe(12);
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(new HwpModel(new (loadNodeCore())(out.bytes), format).summarize().paragraphs).toEqual(edited.paragraphs);
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it('깊이 2 이상의 글상자 문단은 문단 서식을 읽지도 바꾸지도 못한다(코어에 경로 함수가 없다). 이유와 함께 거절하고 아무것도 바꾸지 않는다', async () => {
    const { model } = openBoxSample(NESTED);
    const inner = byText(model.summarize(), '안쪽 글상자 할려고');
    expect(inner?.para).toEqual({});
    const before = model.summarize();
    const r = await model.apply([{ type: 'setParaStyle', paragraph: indexOf(model, '안쪽 글상자 할려고'), style: { align: 'center' } }]);
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
    // 본문에 놓인 바깥 글상자(깊이 1)는 된다.
    const outer = await model.apply([{ type: 'setParaStyle', paragraph: indexOf(model, '바깥 글상자 글'), style: { align: 'right' } }]);
    expect(outer.ok).toBe(true);
  });

  it('표 칸 안에 글상자가 없는 문서(그림만 있는 표)는 안쪽 문단을 살펴도 글상자를 만들어 내지 않는다', () => {
    const { model } = openBoxSample({ body: ['가', '나'], cellBox: undefined });
    expect(model.describeStructure()).toMatchObject({ boxes: 0 });
  });
});

describe('글상자로 "문서에서 보기"', () => {
  it('본문에 놓인 글상자 안 글: 편집기가 글상자 안으로 이동하는 위치(글상자 표시 포함)와 선택할 글의 범위를 준다', () => {
    const { model, boxes } = openBoxSample(SPEC);
    const f = model.cellFocus(indexOf(model, '글상자 둘째줄 되요'), '되요');
    const box = boxes[0] as { para: number; control: number };
    expect(f).toEqual({
      position: { sectionIndex: 0, paragraphIndex: box.para, charOffset: 8, parentParaIndex: box.para, controlIndex: box.control, cellIndex: 0, cellParaIndex: 1, isTextBox: true },
      end: 10,
    });
  });

  it('표 칸·글상자 안에 놓인 글상자: 전체 경로(cellPath)를 주고, 가장 안쪽이 글상자인지 표 칸인지를 isTextBox 로 알린다', () => {
    const { model } = openBoxSample({
      body: ['첫 문단', '표가 놓일 문단'],
      boxes: [{ para: 0, lines: ['바깥 글상자 글'] }],
      cellBox: { para: 1, cells: [['왼쪽 칸', '오른쪽 칸']], at: [0, 1], lines: ['표 칸 안 글상자'] },
      innerTable: { outer: 0, cells: [['글상자 안 표 칸']] },
    });
    const inCell = model.cellFocus(indexOf(model, '표 칸 안 글상자'));
    expect(inCell?.position.cellPath).toHaveLength(2);
    expect(inCell?.position.isTextBox).toBe(true);
    const inBoxTable = model.cellFocus(indexOf(model, '글상자 안 표 칸'));
    expect(inBoxTable?.position.cellPath).toHaveLength(2);
    expect(inBoxTable?.position).not.toHaveProperty('isTextBox'); // 가장 안쪽은 표 칸
  });

  it('편집기가 글상자로 이동하지 못할 때를 위해, 그 글상자를 단 본문 문단과 글상자 위치를 준다', () => {
    const { model } = openBoxSample(SPEC);
    expect(model.paragraphTarget(indexOf(model, '글상자 첫줄 할려고'))).toMatchObject({ section: 0, paragraph: 0, inTable: false, area: { kind: 'textbox', number: 1 } });
  });
});
