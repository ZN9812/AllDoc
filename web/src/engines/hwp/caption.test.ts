// @vitest-environment node
// 한글 문서의 그림·표 캡션 글을 읽고 고치는 시험. 코어가 만든 문서를 파일로 내보냈다가 다시 열어 쓰므로 실제 파일을 여는 것과 같은 경로를 탄다.
// 캡션의 "번호 넣기"(자동 번호)는 코어가 위치 없이 공백 한 글자로만 보여 주는 것을 표지(№)로 바꿔 AI 에게 보이므로, 그 자리를 지키는지가 핵심이다.
import { areaLabel, textGuard, type DocSummary, type Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { decodeUtf8, readZipFiles } from '../docx/zip';
import { captionNumberZone, HwpModel, type HwpFormat } from './model';
import { loadNodeCore, openCaptionSample, TABLE_CAPTION_CELL, TEST_PNG, type CaptionSampleSpec } from './testing';

const FORMATS: HwpFormat[] = ['hwp', 'hwpx'];

// 본문: 0 첫 문단, 1 그림이 놓인 빈 문단, 2·4 표가 놓인 문단(코어가 표 뒤에 빈 문단을 하나씩 더 둔다), 6 끝 문단
// 코어가 새로 만든 표 캡션은 내보냈다가 다시 열면 글 끝에 공백이 하나 붙는다(왕복하면 더 늘지는 않는다. 실제 예제 문서의 캡션은 왕복해도 같다).
const SPEC: CaptionSampleSpec = {
  body: ['첫 문단 몇일 뒤', '', '', '', '끝 문단'],
  pictures: [{ para: 1, caption: '시스템 구성도 할려고' }],
  tables: [
    { para: 2, cells: [['가', '나']], caption: '월별 현황 되요', direction: 'top' },
    { para: 3, cells: [['다']], caption: '분기 현황' },
  ],
};
const PICTURE = '그림 № 시스템 구성도 할려고';
const TABLE_TOP = '표 № 월별 현황 되요 ';
const TABLE_BOTTOM = '표 № 분기 현황 ';

const byText = (s: DocSummary, text: string) => s.paragraphs.find((p) => p.text === text);
const indexOf = (model: HwpModel, text: string): number => {
  const p = byText(model.summarize(), text);
  if (!p) throw new Error(`문단을 찾지 못했어요: ${text}`);
  return p.index;
};
const texts = (s: DocSummary) => s.paragraphs.map((p) => p.text);
const replace = (model: HwpModel, text: string, find: string, to: string, at?: number): Op => ({
  type: 'replaceText',
  paragraph: indexOf(model, text),
  find,
  replace: to,
  ...(at !== undefined ? { at } : {}),
  guard: textGuard(text),
});

type Sample = ReturnType<typeof openCaptionSample>;

/** 코어를 직접 읽어 캡션 문단의 글을 얻는다(모델을 거치지 않는 경로) */
const rawPicture = (doc: Sample['doc'], para: number, control: number): string => {
  const path = JSON.stringify([{ controlIndex: control, cellIndex: 0, cellParaIndex: 0 }]);
  const len = doc.getCellParagraphLengthByPath(0, para, path);
  return len > 0 ? doc.getTextInCellByPath(0, para, path, 0, len) : '';
};
const rawTable = (doc: Sample['doc'], para: number, control: number): string => {
  const len = doc.getCellParagraphLength(0, para, control, TABLE_CAPTION_CELL, 0);
  return len > 0 ? doc.getTextInCell(0, para, control, TABLE_CAPTION_CELL, 0, 0, len) : '';
};

/** 내보낸 HWPX 의 첫 그림 캡션 문단: 번호 컨트롤(autoNum) 앞뒤의 글과 번호 컨트롤의 수 */
async function pictureCaptionXml(bytes: Uint8Array): Promise<{ before: string; after: string; autoNums: number }> {
  const xml = decodeUtf8((await readZipFiles(bytes, ['Contents/section0.xml'])).get('Contents/section0.xml') as Uint8Array);
  const caption = /<hp:caption[\s\S]*?<\/hp:caption>/.exec(xml)?.[0] ?? '';
  const [before = '', after = ''] = caption.split(/<hp:ctrl><hp:autoNum[\s\S]*?<\/hp:autoNum><\/hp:ctrl>/);
  const plain = (s: string): string => [...s.matchAll(/<hp:t>([^<]*)<\/hp:t>/g)].map((m) => m[1]).join('');
  return { before: plain(before), after: plain(after), autoNums: (caption.match(/<hp:autoNum /g) ?? []).length };
}

describe('캡션 번호 자리 어림(captionNumberZone)', () => {
  it('라벨 + 공백 + 번호 자리 + 공백 + 글 모양에서 번호 자리를 찾는다', () => {
    expect(captionNumberZone('그림   시스템 구성도')).toEqual({ at: 3, from: 2, to: 5 });
    expect(captionNumberZone('표  ')).toEqual({ at: 2, from: 1, to: 3 }); // 코어가 새 캡션에 넣는 모양(번호 자리가 덩어리의 첫 글자라 한 글자 어긋나는 쪽으로 어림한다)
    expect(captionNumberZone('Fig.  Overview')).toEqual({ at: 5, from: 4, to: 6 });
  });

  it('번호 자리가 없어 보이는 글(공백이 하나뿐이거나 공백으로 시작하거나 공백이 없다)은 null', () => {
    expect(captionNumberZone('그림 시스템 구성도')).toBeNull();
    expect(captionNumberZone('  그림   시스템')).toBeNull();
    expect(captionNumberZone('그림')).toBeNull();
    expect(captionNumberZone('')).toBeNull();
  });

  it('번호 자리 글자는 일반 공백이어야 한다(사람이 친 숫자 폭 공백·전각 공백 따위는 번호 자리가 아니다)', () => {
    expect(captionNumberZone('Fig. \u20071. CGA Module')).toBeNull(); // 실제 예제 문서의 손으로 쓴 캡션
    expect(captionNumberZone('그림\u3000\u3000설명')).toBeNull();
    expect(captionNumberZone('그림\u3000  설명')).toEqual({ at: 3, from: 2, to: 5 }); // 앞에 전각 공백이 섞여도 번호 자리(일반 공백)는 찾는다
  });
});

describe('캡션 읽기', () => {
  it.each(FORMATS)('%s: 캡션 문단은 개체 다음에(표 캡션은 캡션 방향대로 표 칸 앞·뒤에) 오고, 위치와 번호 자리 표지가 붙는다', (format) => {
    const { model } = openCaptionSample(SPEC, format);
    expect(model.summarize().paragraphs.map((p) => [p.index, p.text, p.area ?? p.cell ?? null])).toEqual([
      [0, '첫 문단 몇일 뒤', null],
      [2, PICTURE, { kind: 'caption', of: 'picture', number: 1 }],
      [4, TABLE_TOP, { kind: 'caption', of: 'table', number: 1 }], // 캡션이 위에 있으니 표 칸보다 앞
      [5, '가', { table: 1, row: 1, col: 1, depth: 1 }],
      [6, '나', { table: 1, row: 1, col: 2, depth: 1 }],
      [9, '다', { table: 2, row: 1, col: 1, depth: 1 }],
      [10, TABLE_BOTTOM, { kind: 'caption', of: 'table', number: 2 }], // 캡션이 아래에 있으니 표 칸보다 뒤
      [12, '끝 문단', null],
    ]);
  });

  it('위치 문구는 "그림 캡션 N"과 "표 N 캡션"이다(표 번호는 표 칸의 위치 문구와 같다)', () => {
    const labels = openCaptionSample(SPEC)
      .model.summarize()
      .paragraphs.flatMap((p) => (p.area ? [areaLabel(p.area)] : []));
    expect(labels).toEqual(['그림 캡션 1', '표 1 캡션', '표 2 캡션']);
  });

  it('캡션 문단도 글자·문단 서식을 읽는다', () => {
    const p = byText(openCaptionSample(SPEC).model.summarize(), PICTURE);
    expect(p?.char.fontSizePt).toBe(10);
    expect(p?.char.fontFamily).toBeTruthy();
    expect(p?.para.align).toBeDefined();
    const t = byText(openCaptionSample(SPEC).model.summarize(), TABLE_TOP);
    expect(t?.char.fontSizePt).toBe(10);
    expect(t?.para.align).toBeDefined();
  });

  it('구조 크기를 센다', () => {
    expect(openCaptionSample(SPEC).model.describeStructure()).toMatchObject({ tables: 2, cellParagraphs: 3, captionParagraphs: 3, pictureCaptions: 1, tableCaptions: 2, boxes: 0, boxParagraphs: 0 });
  });

  it('글 캡션이 없는 그림·표는 캡션 칸이 없다', () => {
    const Doc = loadNodeCore();
    const built = Doc.createEmpty();
    built.createBlankDocument();
    built.insertText(0, 0, 0, '본문');
    built.splitParagraph(0, 0, 2);
    built.insertPicture(0, 0, 0, '', TEST_PNG, 7200, 7200, 1, 1, 'png', '캡션 없는 그림');
    const t = JSON.parse(built.createTable(0, 1, 0, 1, 1)) as { paraIdx: number; controlIdx: number };
    built.insertTextInCell(0, t.paraIdx, t.controlIdx, 0, 0, 0, '칸');
    const model = new HwpModel(new Doc(new Uint8Array(built.exportHwp())), 'hwp');
    expect(model.describeStructure()).toMatchObject({ captionParagraphs: 0, pictureCaptions: 0, tableCaptions: 0 });
    expect(texts(model.summarize())).toEqual(['본문', '칸']);
  });

  it('번호 자리가 없어 보이는 캡션에는 표지를 붙이지 않는다', () => {
    const { model } = openCaptionSample({ body: ['', '', ''], pictures: [{ para: 1, caption: '시스템 구성도' }] }, 'hwp', (doc) => {
      // 번호 자리의 앞뒤 공백(진짜 공백 둘)을 지운다. 번호 컨트롤은 그대로 있지만 글만 보고는 자리를 알 수 없다
      // (번호 자리 글자 자체를 지우는 것은 코어가 글자 수에 반영하지 않아서, 번호 자리는 남는다).
      const path = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]);
      doc.deleteTextInCellByPath(0, 1, path, 4, 1);
      doc.deleteTextInCellByPath(0, 1, path, 2, 1);
    });
    expect(texts(model.summarize())).toEqual(['그림 시스템 구성도']);
  });

  it('표 안의 표에 달린 캡션은 읽지 않는다(코어에 닿는 길이 없다)', () => {
    const Doc = loadNodeCore();
    const b = Doc.createEmpty();
    b.createBlankDocument();
    b.insertText(0, 0, 0, '앞');
    b.splitParagraph(0, 0, 1);
    const outer = JSON.parse(b.createTable(0, 1, 0, 1, 1)) as { paraIdx: number; controlIdx: number };
    b.insertTextInCell(0, outer.paraIdx, outer.controlIdx, 0, 0, 0, '바깥칸');
    const tail = b.getParagraphCount(0) - 1;
    b.splitParagraph(0, tail, b.getParagraphLength(0, tail));
    const temp = JSON.parse(b.createTable(0, tail + 1, 0, 1, 1)) as { paraIdx: number; controlIdx: number };
    b.insertTextInCell(0, temp.paraIdx, temp.controlIdx, 0, 0, 0, '안쪽칸');
    b.setTableProperties(0, temp.paraIdx, temp.controlIdx, JSON.stringify({ hasCaption: true }));
    b.copyControl(0, temp.paraIdx, '', temp.controlIdx);
    b.pasteInternalInCell(0, outer.paraIdx, outer.controlIdx, 0, 0, 3);
    b.deleteTableControl(0, temp.paraIdx, temp.controlIdx);
    const model = new HwpModel(new Doc(new Uint8Array(b.exportHwp())), 'hwp');
    expect(model.describeStructure()).toMatchObject({ tables: 2, captionParagraphs: 0, tableCaptions: 0 });
    expect(texts(model.summarize())).toEqual(['앞', '바깥칸', '안쪽칸']);
  });
});

describe('캡션 글 고치기', () => {
  it.each(FORMATS)('%s: 그림 캡션과 표 캡션 글을 바꾸고 내보내도 같고, 되돌리면 처음과 같다(본문과 한 묶음으로도)', async (format) => {
    const { doc, model, pictures, tables } = openCaptionSample(SPEC, format);
    const before = model.summarize();

    const r = await model.apply([
      replace(model, '첫 문단 몇일 뒤', '몇일', '며칠'),
      replace(model, PICTURE, '할려고', '하려고'),
      replace(model, TABLE_TOP, '되요', '돼요'),
      replace(model, TABLE_BOTTOM, '분기', '월별 분기'),
    ]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;

    // 모델을 거치지 않고 코어를 직접 읽어도 바뀌어 있고, 번호 자리(공백 셋의 가운데)는 그대로다.
    const pic = pictures[0] as { para: number; control: number };
    expect(rawPicture(doc, pic.para, pic.control)).toBe('그림   시스템 구성도 하려고');
    expect(rawTable(doc, (tables[0] as { para: number }).para, (tables[0] as { control: number }).control)).toBe('표   월별 현황 돼요 ');
    expect(rawTable(doc, (tables[1] as { para: number }).para, (tables[1] as { control: number }).control)).toBe('표   월별 분기 현황 ');
    const edited = model.summarize();
    expect(texts(edited)).toEqual(['첫 문단 며칠 뒤', '그림 № 시스템 구성도 하려고', '표 № 월별 현황 돼요 ', '가', '나', '다', '표 № 월별 분기 현황 ', '끝 문단']);
    expect(edited.paragraphs.map((p) => p.area ?? p.cell ?? null)).toEqual(before.paragraphs.map((p) => p.area ?? p.cell ?? null)); // 위치는 그대로

    // 파일로 내보내고 다시 읽어도 같다: 손실이 없고 글·위치·서식이 그대로다.
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    const Doc = loadNodeCore();
    expect(new HwpModel(new Doc(out.bytes), format).summarize().paragraphs).toEqual(edited.paragraphs);

    // 되돌리면 처음과 같다.
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it('내보낸 HWPX 에서 번호 컨트롤(autoNum)이 라벨 뒤·글 앞에 그대로 있다(글을 바꾸고 되돌려도)', async () => {
    const { model } = openCaptionSample(SPEC, 'hwpx');
    expect(await pictureCaptionXml(model.exportBytes().bytes)).toEqual({ before: '그림 ', after: ' 시스템 구성도 할려고', autoNums: 1 });

    const r = await model.apply([replace(model, PICTURE, '시스템 구성도 할려고', '전체 구성도를 하려고')]);
    expect(r.ok).toBe(true);
    expect(await pictureCaptionXml(model.exportBytes().bytes)).toEqual({ before: '그림 ', after: ' 전체 구성도를 하려고', autoNums: 1 });
    if (r.ok) await model.apply(r.inverse);
    expect(await pictureCaptionXml(model.exportBytes().bytes)).toEqual({ before: '그림 ', after: ' 시스템 구성도 할려고', autoNums: 1 });
  });

  it('라벨이나 번호 뒤의 글을 바꾸는 일은 되고, 글 끝에 덧붙이는 일도 된다', async () => {
    const { doc, model, pictures } = openCaptionSample(SPEC, 'hwpx');
    const pic = pictures[0] as { para: number; control: number };
    const label = await model.apply([replace(model, PICTURE, '그림', 'Figure')]);
    expect(label.ok, JSON.stringify(label)).toBe(true);
    expect(rawPicture(doc, pic.para, pic.control)).toBe('Figure   시스템 구성도 할려고');
    expect(await pictureCaptionXml(model.exportBytes().bytes)).toEqual({ before: 'Figure ', after: ' 시스템 구성도 할려고', autoNums: 1 });

    const text = 'Figure № 시스템 구성도 할려고';
    const append = await model.apply([{ type: 'replaceText', paragraph: indexOf(model, text), find: '', replace: ' (2024)', at: [...text].length, guard: textGuard(text) }]);
    expect(append.ok, JSON.stringify(append)).toBe(true);
    expect(rawPicture(doc, pic.para, pic.control)).toBe('Figure   시스템 구성도 할려고 (2024)');
  });

  it.each([
    ['번호 표지를 바꾼다', '№', 'X', undefined],
    ['라벨과 번호를 함께 바꾼다', '그림 №', 'Figure 1', undefined],
    ['번호와 뒤 공백을 함께 바꾼다', '№ 시스템', '번호 시스템', undefined],
    ['라벨과 번호 사이 공백을 바꾼다', ' ', '', 2],
    ['번호 앞에 글을 끼운다', '', 'X', 3],
    ['번호 뒤 공백 앞에 글을 끼운다', '', 'X', 4],
    ['라벨 끝에 공백을 붙인다', '그림', '그림 ', undefined],
    ['글 앞에 공백을 붙인다', '시스템', ' 시스템', undefined],
  ])('번호 자리가 든 공백 덩어리를 건드리는 변경은 거절하고 문서는 그대로다: %s', async (_name, find, to, at) => {
    const { doc, model, pictures } = openCaptionSample(SPEC);
    const pic = pictures[0] as { para: number; control: number };
    const before = model.summarize();
    const r = await model.apply([replace(model, '첫 문단 몇일 뒤', '몇일', '며칠'), replace(model, PICTURE, find, to, at)]);
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(rawPicture(doc, pic.para, pic.control)).toBe('그림   시스템 구성도 할려고');
    expect(model.summarize().paragraphs).toEqual(before.paragraphs); // 한 묶음이라 앞의 본문 변경도 취소된다
  });

  it('글자 서식(굵게·크기·글꼴)을 바꾸고 되돌린다(그림 캡션과 표 캡션)', async () => {
    const { doc, model, pictures, tables } = openCaptionSample(SPEC);
    const before = model.summarize();
    const r = await model.apply([
      { type: 'setCharStyle', paragraph: indexOf(model, PICTURE), style: { bold: true, fontSizePt: 9 }, guard: textGuard(PICTURE) },
      { type: 'setCharStyle', paragraph: indexOf(model, TABLE_TOP), style: { bold: true, fontSizePt: 9 }, guard: textGuard(TABLE_TOP) },
    ]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    const pic = pictures[0] as { para: number; control: number };
    const tbl = tables[0] as { para: number; control: number };
    const picProps = JSON.parse(doc.getCellCharPropertiesAtByPath(0, pic.para, JSON.stringify([{ controlIndex: pic.control, cellIndex: 0, cellParaIndex: 0 }]), 0)) as { bold: boolean; fontSize: number };
    const tblProps = JSON.parse(doc.getCellCharPropertiesAt(0, tbl.para, tbl.control, TABLE_CAPTION_CELL, 0, 0)) as { bold: boolean; fontSize: number };
    expect([picProps.bold, picProps.fontSize, tblProps.bold, tblProps.fontSize]).toEqual([true, 900, true, 900]);
    const after = model.summarize();
    expect(byText(after, PICTURE)?.char).toMatchObject({ bold: true, fontSizePt: 9 });
    expect(byText(after, TABLE_TOP)?.char).toMatchObject({ bold: true, fontSizePt: 9 });
    expect(byText(after, TABLE_BOTTOM)?.char).toEqual(byText(before, TABLE_BOTTOM)?.char); // 다른 캡션은 그대로
    expect(model.exportBytes().lossCount).toBe(0);

    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it('문단 서식(정렬·줄 간격)을 바꾸고 되돌린다(본문에 놓인 그림·표의 캡션)', async () => {
    const { doc, model, pictures, tables } = openCaptionSample(SPEC);
    const before = model.summarize();
    const r = await model.apply([
      { type: 'setParaStyle', paragraph: indexOf(model, PICTURE), style: { align: 'center', lineSpacingPct: 130 }, guard: textGuard(PICTURE) },
      { type: 'setParaStyle', paragraph: indexOf(model, TABLE_BOTTOM), style: { align: 'right' }, guard: textGuard(TABLE_BOTTOM) },
    ]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    if (!r.ok) return;
    const pic = pictures[0] as { para: number; control: number };
    const tbl = tables[1] as { para: number; control: number };
    expect(JSON.parse(doc.getCellParaPropertiesAt(0, pic.para, pic.control, 0, 0))).toMatchObject({ alignment: 'center', lineSpacing: 130 });
    expect(JSON.parse(doc.getCellParaPropertiesAt(0, tbl.para, tbl.control, TABLE_CAPTION_CELL, 0))).toMatchObject({ alignment: 'right' });
    expect(byText(model.summarize(), PICTURE)?.para).toMatchObject({ align: 'center', lineSpacingPct: 130 });
    expect(model.exportBytes().lossCount).toBe(0);

    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  it('문서가 바뀐 뒤의 오래된 제안은 거절한다', async () => {
    const { model } = openCaptionSample(SPEC);
    const stale = replace(model, PICTURE, '할려고', '하려고');
    expect((await model.apply([replace(model, PICTURE, '시스템', '전체')])).ok).toBe(true);
    expect(await model.apply([stale])).toMatchObject({ ok: false, reason: 'stale' });
  });
});

describe('표 칸 안에 놓인 그림의 캡션', () => {
  /** 표 칸 문단에 글 캡션이 달린 그림을 붙인다(코어에는 칸 문단 안에 그림을 바로 만드는 함수가 없어서 복사해 붙인다). */
  function openCellPicture(format: HwpFormat): Sample {
    const Doc = loadNodeCore();
    const built = Doc.createEmpty();
    built.createBlankDocument();
    built.insertText(0, 0, 0, '그림 위 문단');
    built.splitParagraph(0, 0, built.getParagraphLength(0, 0));
    built.insertPicture(0, 0, 0, '', TEST_PNG, 7200, 7200, 1, 1, 'png', '본문 그림');
    built.setPictureProperties(0, 0, 2, JSON.stringify({ hasCaption: true }));
    const path = JSON.stringify([{ controlIndex: 2, cellIndex: 0, cellParaIndex: 0 }]);
    built.insertTextInCellByPath(0, 0, path, 2, ' ');
    built.insertTextInCellByPath(0, 0, path, built.getCellParagraphLengthByPath(0, 0, path), '칸 안 그림 설명');
    const table = JSON.parse(built.createTable(0, 1, 0, 1, 1)) as { paraIdx: number; controlIdx: number };
    built.insertTextInCell(0, table.paraIdx, table.controlIdx, 0, 0, 0, '칸 안 문단');
    built.copyControl(0, 0, '', 2);
    built.pasteInternalInCell(0, table.paraIdx, table.controlIdx, 0, 0, 5);
    built.deletePictureControl(0, 0, 2); // 본문의 원본 그림은 지운다(칸 안의 그림만 남긴다)
    const doc = new Doc(new Uint8Array(format === 'hwp' ? built.exportHwp() : built.exportHwpx()));
    return { doc, model: new HwpModel(doc, format), pictures: [], tables: [{ para: table.paraIdx, control: table.controlIdx }] };
  }

  it.each(FORMATS)('%s: 칸 안 그림의 캡션을 읽고 글을 고치고 되돌린다. 문단 서식은 거절한다', async (format) => {
    const { model, tables } = openCellPicture(format);
    expect(model.describeStructure()).toMatchObject({ tables: 1, pictureCaptions: 1, captionParagraphs: 1 });
    const s = model.summarize();
    expect(s.paragraphs.map((p) => [p.text, p.area ?? p.cell ?? null])).toEqual([
      ['그림 위 문단', null],
      ['칸 안 문단', { table: 1, row: 1, col: 1, depth: 1 }],
      ['그림 № 칸 안 그림 설명', { kind: 'caption', of: 'picture', number: 1 }],
    ]);
    const before = s.paragraphs;

    const text = '그림 № 칸 안 그림 설명';
    const r = await model.apply([{ type: 'replaceText', paragraph: indexOf(model, text), find: '설명', replace: '해설', guard: textGuard(text) }]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    expect(texts(model.summarize())).toContain('그림 № 칸 안 그림 해설');
    if (r.ok) expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before);

    const para = await model.apply([{ type: 'setParaStyle', paragraph: indexOf(model, text), style: { align: 'center' }, guard: textGuard(text) }]);
    expect(para).toMatchObject({ ok: false, reason: 'unsupported' });

    // 글자 서식은 된다.
    const chr = await model.apply([{ type: 'setCharStyle', paragraph: indexOf(model, text), style: { bold: true }, guard: textGuard(text) }]);
    expect(chr, JSON.stringify(chr)).toMatchObject({ ok: true });
    expect(byText(model.summarize(), text)?.char.bold).toBe(true);

    // 그 칸에 놓인 위치로 이동할 수 있다: 경로가 두 단계다(표 칸 → 그림의 캡션).
    const focus = model.cellFocus(indexOf(model, text), '그림');
    expect(focus?.position).toMatchObject({ controlIndex: (tables[0] as { control: number }).control, cellIndex: 0, cellParaIndex: 0, cellPath: [{ controlIndex: (tables[0] as { control: number }).control }, { controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }] });
    expect(focus?.position.isTextBox).toBeUndefined();
  });
});

describe('캡션으로 이동(문서에서 보기) 위치', () => {
  it('그림 캡션은 개체 번호와 칸 번호 0, 표 캡션은 칸 번호 65534 로 가리킨다', () => {
    const { model, pictures, tables } = openCaptionSample(SPEC);
    const pic = pictures[0] as { para: number; control: number };
    const tbl = tables[1] as { para: number; control: number };
    const p = model.cellFocus(indexOf(model, PICTURE), '그림');
    expect(p?.position).toMatchObject({ parentParaIndex: pic.para, controlIndex: pic.control, cellIndex: 0, cellParaIndex: 0, charOffset: 0 });
    expect(p?.end).toBe(2);
    const f = model.cellFocus(indexOf(model, TABLE_BOTTOM), '표');
    expect(f?.position).toMatchObject({ parentParaIndex: tbl.para, controlIndex: tbl.control, cellIndex: TABLE_CAPTION_CELL, cellParaIndex: 0, charOffset: 0 });
    expect(f?.position.isTextBox).toBeUndefined();
    expect(f?.tooBig).toBeUndefined();
    expect(f?.approximate).toBeUndefined();
  });

  // 코어는 캡션의 자동 번호를 글 속에 글자로 끼워 그려서, 편집기의 글자 위치는 번호 뒤에서 번호의 글자 수만큼 어긋난다(실제 편집기에서 확인했다).
  // 그래서 번호 뒤의 글은 선택으로 가리키지 않고 번호 앞에 캐럿만 둔다.
  it('번호 뒤에 있는 글은 선택하지 않고 번호 앞에 캐럿만 두며 그렇다고 알린다', () => {
    const { model } = openCaptionSample(SPEC);
    const p = model.cellFocus(indexOf(model, PICTURE), '구성도');
    expect(p?.position.charOffset).toBe([...'그림 '].length); // 번호 표지(№)가 있는 자리 = 번호가 그려지는 자리
    expect(p?.end).toBeUndefined();
    expect(p?.approximate).toBe(true);
    const t = model.cellFocus(indexOf(model, TABLE_BOTTOM), '분기');
    expect(t?.position).toMatchObject({ cellIndex: TABLE_CAPTION_CELL, charOffset: [...'표 '].length });
    expect(t?.end).toBeUndefined();
    expect(t?.approximate).toBe(true);
  });

  it('라벨 앞에 UTF-16 두 칸짜리 글자(이모지)가 있어도 번호 자리는 코어의 글자 위치로 센다', () => {
    const { model } = openCaptionSample({ body: ['', '', ''], pictures: [{ para: 1, caption: '시스템 구성도' }] }, 'hwp', (doc) => {
      doc.insertTextInCellByPath(0, 1, JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]), 0, '😀');
    });
    const text = '😀그림 № 시스템 구성도';
    expect(texts(model.summarize())).toEqual([text]);
    const f = model.cellFocus(indexOf(model, text), '시스템');
    expect(f?.position.charOffset).toBe([...'😀그림 '].length); // 번호 자리 = 코드 포인트 4번째(자바스크립트 문자열 위치로는 5)
    expect(f?.approximate).toBe(true);
    const label = model.cellFocus(indexOf(model, text), '그림');
    expect(label?.position.charOffset).toBe(1);
    expect(label?.end).toBe(3);
    expect(label?.approximate).toBeUndefined();
  });

  it('번호가 없어 보이는 캡션은 번호 뒤의 글도 그대로 선택한다', () => {
    const { model } = openCaptionSample({ body: ['', '', ''], pictures: [{ para: 1, caption: '시스템 구성도' }] }, 'hwp', (doc) => {
      const path = JSON.stringify([{ controlIndex: 0, cellIndex: 0, cellParaIndex: 0 }]);
      doc.deleteTextInCellByPath(0, 1, path, 4, 1);
      doc.deleteTextInCellByPath(0, 1, path, 2, 1);
    });
    const f = model.cellFocus(indexOf(model, '그림 시스템 구성도'), '구성도');
    expect(f?.position.charOffset).toBe([...'그림 시스템 '].length);
    expect(f?.end).toBe([...'그림 시스템 구성도'].length);
    expect(f?.approximate).toBeUndefined();
  });

  it('문단 안내(paragraphTarget)는 개체가 놓인 본문 문단과 캡션 위치를 준다', () => {
    const { model, pictures } = openCaptionSample(SPEC);
    const pic = pictures[0] as { para: number; control: number };
    expect(model.paragraphTarget(indexOf(model, PICTURE))).toMatchObject({ section: 0, paragraph: pic.para, inTable: false, area: { kind: 'caption', of: 'picture', number: 1 } });
  });
});
