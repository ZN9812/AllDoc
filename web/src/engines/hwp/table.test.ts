// @vitest-environment node
// 표 칸 안의 글(표 안의 표 포함)을 읽고 고치는 시험. 코어가 만든 문서를 파일로 내보냈다가 다시 열어 쓰므로 실제 파일을 여는 것과 같은 경로를 탄다.
import { textGuard, type DocSummary, type Op } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { HwpModel, MAX_FOCUS_TABLE_PARAGRAPHS, type HwpDocLike } from './model';
import { loadNodeCore, openTableSample, type TableSampleSpec } from './testing';

// 본문 0 제목, 1 안내, 2 (표가 놓인 빈 문단), 표 칸 3~6, 7 맺음
const SPEC: TableSampleSpec = {
  before: ['제목 문단', '안내 문단'],
  cells: [
    ['성명', '홍길동'],
    ['신청 사유', '몇일 동안 휴가를 할려고 합니다'],
  ],
  after: ['맺음 문단'],
};
// 바깥 표의 1행 2열 칸(홍길동) 안에 작은 표를 하나 더 넣는다.
const NESTED: TableSampleSpec = { ...SPEC, nested: { at: [0, 1], cells: [['안쪽 가', '안쪽 몇일 나']] } };

const byText = (s: DocSummary, text: string) => s.paragraphs.find((p) => p.text === text);
const indexOf = (model: HwpModel, text: string): number => {
  const p = byText(model.summarize(), text);
  if (!p) throw new Error(`문단을 찾지 못했어요: ${text}`);
  return p.index;
};
const texts = (s: DocSummary) => s.paragraphs.map((p) => p.text);

describe('표 칸 안의 문단 읽기', () => {
  it('본문 문단 다음에 표 칸 안 문단이 문서 순서로 이어지고, 칸의 위치(표 번호·행·열)를 가진다', () => {
    const { model } = openTableSample(SPEC);
    const s = model.summarize();
    expect(s.paragraphs.map((p) => [p.index, p.text])).toEqual([
      [0, '제목 문단'],
      [1, '안내 문단'],
      // 2 는 표가 놓인 빈 문단이라 요약에서 빠진다(번호만 건너뛴다)
      [3, '성명'],
      [4, '홍길동'],
      [5, '신청 사유'],
      [6, '몇일 동안 휴가를 할려고 합니다'],
      [7, '맺음 문단'],
    ]);
    expect(byText(s, '제목 문단')?.cell).toBeUndefined();
    expect(byText(s, '맺음 문단')?.cell).toBeUndefined();
    expect(byText(s, '성명')?.cell).toEqual({ table: 1, row: 1, col: 1, depth: 1 });
    expect(byText(s, '몇일 동안 휴가를 할려고 합니다')?.cell).toEqual({ table: 1, row: 2, col: 2, depth: 1 });
    // 칸 안 글도 글꼴·크기를 가진다
    expect(byText(s, '성명')?.char).toMatchObject({ fontSizePt: 10 });
    expect(byText(s, '성명')?.para).toMatchObject({ align: expect.any(String) });
  });

  it('표 안의 표도 담는다: 바깥 칸 바로 뒤에 안쪽 표의 칸이 오고, 표 번호는 문서 순서로 센다', () => {
    const { model } = openTableSample(NESTED);
    const s = model.summarize();
    expect(s.paragraphs.map((p) => [p.index, p.text, p.cell ? `표${p.cell.table} ${p.cell.row}행${p.cell.col}열 깊이${p.cell.depth}` : '본문'])).toEqual([
      [0, '제목 문단', '본문'],
      [1, '안내 문단', '본문'],
      [3, '성명', '표1 1행1열 깊이1'],
      [4, '홍길동', '표1 1행2열 깊이1'],
      [5, '안쪽 가', '표2 1행1열 깊이2'],
      [6, '안쪽 몇일 나', '표2 1행2열 깊이2'],
      [7, '신청 사유', '표1 2행1열 깊이1'],
      [8, '몇일 동안 휴가를 할려고 합니다', '표1 2행2열 깊이1'],
      [9, '맺음 문단', '본문'],
    ]);
  });

  it('표가 없는 문서는 번호가 본문 문단 번호와 같다(예전과 같다)', () => {
    const { model } = openTableSample({ before: ['가', '나'], cells: [['다']] });
    // 표 칸이 있으면 달라지지만, 표 앞의 본문 번호는 그대로다.
    expect(model.summarize().paragraphs.slice(0, 2).map((p) => p.index)).toEqual([0, 1]);
  });

  it('편집기로 이동할 때는 표 안 문단을 그 표가 놓인 본문 문단으로 안내한다', () => {
    const { model } = openTableSample(SPEC);
    expect(model.paragraphTarget(indexOf(model, '제목 문단'))).toMatchObject({ section: 0, paragraph: 0, inTable: false });
    const target = model.paragraphTarget(indexOf(model, '홍길동'));
    expect(target).toMatchObject({ section: 0, paragraph: 2, inTable: true });
    expect(model.paragraphTarget(999)).toBeNull();
  });
});

describe('편집기를 표 칸으로 이동시키는 위치', () => {
  const step = (cellIndex: number) => ({ controlIndex: 0, cellIndex, cellParaIndex: 0 });

  it('본문 문단과 없는 문단은 위치가 없다(본문은 편집기의 공개 이동 수단으로 간다)', () => {
    const { model } = openTableSample(NESTED);
    expect(model.cellFocus(indexOf(model, '제목 문단'))).toBeNull();
    expect(model.cellFocus(999)).toBeNull();
  });

  it('바깥 표 칸은 칸 좌표를, 안쪽 표 칸은 전체 경로(cellPath)까지 준다', () => {
    const { model } = openTableSample(NESTED);
    // 표는 본문 문단 2 에 놓여 있다(0 제목, 1 안내, 2 표).
    expect(model.cellFocus(indexOf(model, '몇일 동안 휴가를 할려고 합니다'))).toEqual({
      position: { sectionIndex: 0, paragraphIndex: 2, charOffset: 0, parentParaIndex: 2, controlIndex: 0, cellIndex: 3, cellParaIndex: 0 },
    });
    // 안쪽 표는 바깥 표 2번 칸(홍길동)의 첫 문단에 놓여 있다. 평평한 좌표는 바깥 표 기준이다.
    expect(model.cellFocus(indexOf(model, '안쪽 몇일 나'))).toEqual({
      position: {
        sectionIndex: 0,
        paragraphIndex: 2,
        charOffset: 0,
        parentParaIndex: 2,
        controlIndex: 0,
        cellIndex: 1,
        cellParaIndex: 0,
        cellPath: [step(1), step(1)],
      },
    });
  });

  it('고칠 글(find)이 문단에 있으면 그 글을 선택하도록 시작과 끝을 글자 수로 준다', () => {
    const { model } = openTableSample(NESTED);
    const i = indexOf(model, '몇일 동안 휴가를 할려고 합니다');
    // "몇일 동안 휴가를 " 이 10글자라서 "할려고" 는 10~13
    expect(model.cellFocus(i, '할려고')).toMatchObject({ position: { charOffset: 10 }, end: 13 });
    // 문단에 없는 글이면 문단 앞에 캐럿만 놓는다.
    const none = model.cellFocus(i, '없는글');
    expect(none?.position.charOffset).toBe(0);
    expect(none?.end).toBeUndefined();
  });

  it('위치와 길이는 UTF-16 이 아니라 글자(코드 포인트) 수로 센다', () => {
    const { model } = openTableSample({ cells: [['𠮷𠮷 몇일 뒤']] });
    const i = indexOf(model, '𠮷𠮷 몇일 뒤');
    // 𠮷 은 UTF-16 으로 2칸이지만 한 글자다.
    expect(model.cellFocus(i, '몇일')).toMatchObject({ position: { charOffset: 3 }, end: 5 });
  });

  it('가장 바깥 표의 문단이 250개를 넘으면 칸으로 이동하지 않도록 알린다(편집기가 오래 멈춘다)', () => {
    const rows = Array.from({ length: MAX_FOCUS_TABLE_PARAGRAPHS + 10 }, (_, k) => [`${k}번째 줄 몇일`]);
    const { model } = openTableSample({ cells: rows, after: ['뒤 문단'] });
    const f = model.cellFocus(indexOf(model, '3번째 줄 몇일'), '몇일');
    expect(f?.tooBig).toBe(true);
    expect(f?.end).toBeUndefined();
    // 작은 표는 그대로 이동한다.
    const small = openTableSample({ cells: [['가 몇일']] });
    const g = small.model.cellFocus(indexOf(small.model, '가 몇일'), '몇일');
    expect(g).toMatchObject({ end: 4 });
    expect(g?.tooBig).toBeUndefined();
  });

  it('표 크기는 안쪽 표까지 합쳐 가장 바깥 표 하나를 기준으로 센다', () => {
    // 바깥 표 하나(칸 1개)가 안쪽 표 260칸을 품은 문서: 바깥 표 칸의 글도 큰 표에 든 것으로 본다.
    const { model } = openTableSample({
      cells: [['바깥 몇일']],
      nested: { at: [0, 0], cells: Array.from({ length: MAX_FOCUS_TABLE_PARAGRAPHS + 10 }, (_, k) => [`안쪽 ${k}`]) },
    });
    expect(model.cellFocus(indexOf(model, '바깥 몇일'), '몇일')?.tooBig).toBe(true);
    expect(model.cellFocus(indexOf(model, '안쪽 5'), '쪽')?.tooBig).toBe(true);
  });
});

describe('표 칸 안의 글 바꾸기', () => {
  it('바꾸고, 역변경으로 정확히 되돌린다(다른 문단과 서식은 그대로)', async () => {
    const { model } = openTableSample(SPEC);
    const before = model.summarize();
    const i = indexOf(model, '몇일 동안 휴가를 할려고 합니다');
    const r = await model.apply([{ type: 'replaceText', paragraph: i, find: '몇일', replace: '며칠' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = model.summarize();
    expect(byText(after, '며칠 동안 휴가를 할려고 합니다')).toBeDefined();
    expect(byText(after, '며칠 동안 휴가를 할려고 합니다')?.char).toEqual(byText(before, '몇일 동안 휴가를 할려고 합니다')?.char);
    expect(texts(after).filter((t) => !t.includes('동안'))).toEqual(texts(before).filter((t) => !t.includes('동안')));
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });

  it('표 안의 표 칸의 글도 바꾸고 되돌린다', async () => {
    const { model } = openTableSample(NESTED);
    const before = model.summarize();
    const i = indexOf(model, '안쪽 몇일 나');
    const r = await model.apply([{ type: 'replaceText', paragraph: i, find: '몇일', replace: '며칠' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(byText(model.summarize(), '안쪽 며칠 나')?.cell).toMatchObject({ table: 2, depth: 2 });
    expect((await model.apply(r.inverse)).ok).toBe(true);
    expect(model.summarize()).toEqual(before);
  });

  it('글자 모양이 갈린 글을 바꿔도, 새 글은 바꾼 범위 첫 글자의 서식을 이어받는다', async () => {
    // 칸의 글 "몇일 동안 …" 에서 앞 두 글자만 굵게 14pt. "일 동"(굵은 '일' + 보통 ' 동')을 바꾼다.
    const { model, doc, host } = openTableSample(SPEC, 'hwp', (d) => d.applyCharFormatInCell(0, 2, 0, 3, 0, 0, 2, JSON.stringify({ bold: true, fontSize: 1400 })));
    const path = JSON.stringify([{ controlIndex: 0, cellIndex: 3, cellParaIndex: 0 }]);
    const at = (offset: number) => JSON.parse(doc.getCellCharPropertiesAtByPath(0, host, path, offset)) as { bold?: boolean; fontSize?: number };
    expect(at(1)).toMatchObject({ bold: true, fontSize: 1400 });
    expect(at(3)).toMatchObject({ fontSize: 1000 });

    const i = indexOf(model, '몇일 동안 휴가를 할려고 합니다');
    const r = await model.apply([{ type: 'replaceText', paragraph: i, find: '일 동', replace: '일주일 동' }]);
    expect(r.ok).toBe(true);
    expect(byText(model.summarize(), '몇일주일 동안 휴가를 할려고 합니다')).toBeDefined();
    // 새 글 "일주일 동"(1~5번째 글자)은 모두 첫 글자('일')의 굵은 14pt 이고, 뒤의 "안 휴가…"는 그대로 보통 10pt 다.
    for (const offset of [1, 2, 3, 4]) expect(at(offset)).toMatchObject({ bold: true, fontSize: 1400 });
    expect(at(6)).toMatchObject({ fontSize: 1000 });
    expect(at(6).bold).toBeFalsy();
  });

  it('같은 문단을 여러 번 고치는 묶음도 적용하고, 한 번에 되돌린다', async () => {
    const { model } = openTableSample(SPEC);
    const before = model.summarize();
    const i = indexOf(model, '몇일 동안 휴가를 할려고 합니다');
    const g = textGuard('몇일 동안 휴가를 할려고 합니다');
    const r = await model.apply([
      { type: 'replaceText', paragraph: i, find: '몇일', replace: '며칠', guard: g },
      { type: 'replaceText', paragraph: i, find: '할려고', replace: '하려고', guard: g },
    ]);
    expect(r.ok).toBe(true);
    expect(byText(model.summarize(), '며칠 동안 휴가를 하려고 합니다')).toBeDefined();
    if (r.ok) {
      expect((await model.apply(r.inverse)).ok).toBe(true);
      expect(model.summarize()).toEqual(before);
    }
  });

  it('제안을 만들 때 본 글과 지금 글이 다르면 적용하지 않고, 없는 글이나 줄바꿈 변경도 거절한다', async () => {
    const { model } = openTableSample(SPEC);
    const i = indexOf(model, '몇일 동안 휴가를 할려고 합니다');
    expect(await model.apply([{ type: 'replaceText', paragraph: i, find: '몇일', replace: '며칠', guard: textGuard('다른 글') }])).toMatchObject({ ok: false, reason: 'stale' });
    expect(await model.apply([{ type: 'replaceText', paragraph: i, find: '없는글', replace: 'x' }])).toMatchObject({ ok: false, reason: 'stale' });
    expect(await model.apply([{ type: 'replaceText', paragraph: i, find: '몇일', replace: '며칠\n뒤' }])).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(byText(model.summarize(), '몇일 동안 휴가를 할려고 합니다')).toBeDefined();
  });

  it('글을 지웠다가 되돌리면 원래대로', async () => {
    const { model } = openTableSample(SPEC);
    const before = model.summarize();
    const i = indexOf(model, '몇일 동안 휴가를 할려고 합니다');
    const r = await model.apply([{ type: 'replaceText', paragraph: i, find: ' 휴가를 할려고 합니다', replace: '' }]);
    expect(byText(model.summarize(), '몇일 동안')).toBeDefined();
    if (r.ok) {
      expect((await model.apply(r.inverse)).ok).toBe(true);
      expect(model.summarize()).toEqual(before);
    }
  });
});

describe('표 칸 안의 서식', () => {
  it('글자 서식(크기·굵기·글꼴)을 바꾸고 되돌린다', async () => {
    const { model } = openTableSample(SPEC);
    const before = model.summarize();
    const i = indexOf(model, '성명');
    const r = await model.apply([{ type: 'setCharStyle', paragraph: i, style: { fontSizePt: 13, bold: true, fontFamily: '맑은 고딕' } }]);
    expect(r.ok).toBe(true);
    expect(byText(model.summarize(), '성명')?.char).toMatchObject({ fontSizePt: 13, bold: true, fontFamily: '맑은 고딕' });
    expect(byText(model.summarize(), '홍길동')?.char).toEqual(byText(before, '홍길동')?.char);
    if (r.ok) {
      expect((await model.apply(r.inverse)).ok).toBe(true);
      expect(model.summarize()).toEqual(before);
    }
  });

  it('표 안의 표 칸의 글자 서식도 바꾸고 되돌린다', async () => {
    const { model } = openTableSample(NESTED);
    const before = model.summarize();
    const r = await model.apply([{ type: 'setCharStyle', paragraph: indexOf(model, '안쪽 가'), style: { fontSizePt: 15 } }]);
    expect(r.ok).toBe(true);
    expect(byText(model.summarize(), '안쪽 가')?.char.fontSizePt).toBe(15);
    if (r.ok) {
      await model.apply(r.inverse);
      expect(model.summarize()).toEqual(before);
    }
  });

  it('문단 서식(정렬·줄 간격)을 바꾸고 되돌린다 — 본문에 놓인 표의 칸', async () => {
    const { model } = openTableSample(SPEC);
    const before = model.summarize();
    const i = indexOf(model, '신청 사유');
    const r = await model.apply([{ type: 'setParaStyle', paragraph: i, style: { align: 'center', lineSpacingPct: 130 } }]);
    expect(r.ok).toBe(true);
    expect(byText(model.summarize(), '신청 사유')?.para).toEqual({ align: 'center', lineSpacingPct: 130 });
    expect(byText(model.summarize(), '성명')?.para).toEqual(byText(before, '성명')?.para);
    if (r.ok) {
      await model.apply(r.inverse);
      expect(model.summarize()).toEqual(before);
    }
  });

  it('코어는 표 안의 표 칸의 문단 서식 쓰기를 아직 거절한다(칸 번호를 쓰는 함수로도 마찬가지). 지원하게 되면 이 시험이 실패하니, 그때 모델의 제한을 푼다', () => {
    const { doc } = openTableSample(NESTED);
    const core = doc as unknown as { getCursorModel(): string; applyParaFormatAtCursor(list: number, para: number, json: string): string };
    const lists = (JSON.parse(core.getCursorModel()) as { lists: Array<{ listId: number; hostListId: number }> }).lists;
    const props = JSON.stringify({ alignment: 'center' });
    const nested = lists.find((l) => l.hostListId !== 0);
    expect(nested, '안쪽 표 칸의 목록을 찾지 못했어요').toBeDefined();
    expect(() => core.applyParaFormatAtCursor((nested as { listId: number }).listId, 0, props)).toThrow(/중첩 셀/);
    // 본문에 놓인 표의 칸은 같은 함수로 된다.
    const outer = lists.find((l) => l.hostListId === 0);
    expect(JSON.parse(core.applyParaFormatAtCursor((outer as { listId: number }).listId, 0, props))).toMatchObject({ ok: true });
  });

  it('표 안의 표 칸의 문단 서식은 코어가 쓰기를 거절해서 바꾸지 않고 이유를 알린다', async () => {
    const { model } = openTableSample(NESTED);
    const i = indexOf(model, '안쪽 가');
    expect(byText(model.summarize(), '안쪽 가')?.para).toEqual({}); // 정렬·줄 간격을 알 수 없다
    const r = await model.apply([{ type: 'setParaStyle', paragraph: i, style: { align: 'center' } }]);
    expect(r).toMatchObject({ ok: false, reason: 'unsupported' });
    if (!r.ok) expect(r.message).toContain('표 안의 표');
  });
});

describe('묶음 적용', () => {
  it('본문과 표 칸을 함께 바꾸다 하나라도 실패하면 모두 되돌린다', async () => {
    const { model } = openTableSample(SPEC);
    const before = model.summarize();
    const ops: Op[] = [
      { type: 'replaceText', paragraph: indexOf(model, '몇일 동안 휴가를 할려고 합니다'), find: '몇일', replace: '며칠' },
      { type: 'setCharStyle', paragraph: indexOf(model, '제목 문단'), style: { fontSizePt: 20 } },
      { type: 'setCharStyle', paragraph: indexOf(model, '성명'), style: { bold: true } },
      { type: 'replaceText', paragraph: indexOf(model, '홍길동'), find: '없는글', replace: 'x' },
    ];
    expect(await model.apply(ops)).toMatchObject({ ok: false, reason: 'stale' });
    expect(model.summarize()).toEqual(before);
  });

  it('쪽 나누기 계산을 미루는 묶음 모드로 적용하고, 실패해도 반드시 끝낸다', async () => {
    const { doc } = openTableSample(SPEC);
    const calls: string[] = [];
    const spy = new Proxy(doc, {
      get(target, prop) {
        const value = (target as unknown as Record<string | symbol, unknown>)[prop];
        return typeof value === 'function'
          ? (...args: unknown[]) => {
              if (prop === 'beginBatch' || prop === 'endBatch') calls.push(String(prop));
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            }
          : value;
      },
    }) as unknown as HwpDocLike;
    const model = new HwpModel(spy, 'hwp');
    const i = indexOf(model, '성명');
    expect((await model.apply([{ type: 'setCharStyle', paragraph: i, style: { bold: true } }])).ok).toBe(true);
    expect(calls).toEqual(['beginBatch', 'endBatch']);

    calls.length = 0;
    expect((await model.apply([{ type: 'replaceText', paragraph: i, find: '없는글', replace: 'x' }])).ok).toBe(false);
    expect(calls).toEqual(['beginBatch', 'endBatch']);
  });
});

describe('내보내기', () => {
  it('표 안에서 고친 내용이 파일에 담기고 다시 열면 같다(HWP, HWPX, 표 안의 표 포함)', async () => {
    for (const format of ['hwp', 'hwpx'] as const) {
      const { model } = openTableSample(NESTED, format);
      const r = await model.apply([
        { type: 'replaceText', paragraph: indexOf(model, '몇일 동안 휴가를 할려고 합니다'), find: '몇일', replace: '며칠' },
        { type: 'replaceText', paragraph: indexOf(model, '안쪽 몇일 나'), find: '몇일', replace: '며칠' },
        { type: 'setCharStyle', paragraph: indexOf(model, '성명'), style: { fontSizePt: 14, bold: true } },
      ]);
      expect(r.ok).toBe(true);
      const out = model.exportBytes();
      expect(out.lossCount).toBe(0);
      const Doc = loadNodeCore();
      const reopened = new HwpModel(new Doc(out.bytes), format).summarize();
      expect(byText(reopened, '며칠 동안 휴가를 할려고 합니다')?.cell).toMatchObject({ table: 1, depth: 1 });
      expect(byText(reopened, '안쪽 며칠 나')?.cell).toMatchObject({ table: 2, depth: 2 });
      expect(byText(reopened, '성명')?.char).toMatchObject({ fontSizePt: 14, bold: true });
      expect(byText(reopened, '맺음 문단')?.cell).toBeUndefined();
    }
  });

  it('글 바꾸기와 서식 변경은 문단 수를 바꾸지 않아서, 적용한 뒤에도 같은 번호가 같은 문단을 가리킨다', async () => {
    const { model } = openTableSample(NESTED);
    const before = model.summarize();
    await model.apply([{ type: 'replaceText', paragraph: indexOf(model, '안쪽 몇일 나'), find: '몇일', replace: '며칠' }]);
    const after = model.summarize();
    expect(after.paragraphs.map((p) => p.index)).toEqual(before.paragraphs.map((p) => p.index));
  });
});
