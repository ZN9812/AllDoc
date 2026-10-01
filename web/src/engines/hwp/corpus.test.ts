// @vitest-environment node
// 실제 한글 문서(rhwp 저장소가 예제로 두는 파일들)로 읽기·고치기·되돌리기·내보내기를 시험한다.
// 파일은 한글 편집기를 빌드할 때 .cache/rhwp-studio 에 받아진다. 없으면(받지 않은 환경) 건너뛴다.
// 다만 REQUIRE_HWP_SAMPLES=1 이면(CI) 건너뛰지 않고 실패한다. 조용히 빠진 채로 통과하지 않게 하려는 것이다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textGuard, type Op, type ParagraphInfo } from '@alldoc/shared';
import { describe, expect, it } from 'vitest';
import { analyzeConsistency } from '../../ai/consistency';
import { HwpModel, type HwpFormat } from './model';
import { loadNodeCore } from './testing';

// RHWP_SAMPLES_DIR 로 예제 폴더를 바꿀 수 있다(없는 폴더를 가리켜 "예제 없음" 상황을 시험할 때도 쓴다).
const DIR = process.env.RHWP_SAMPLES_DIR || join(__dirname, '../../../../.cache/rhwp-studio/src/rhwp-studio/public/samples');
const REQUIRED = process.env.REQUIRE_HWP_SAMPLES === '1';
const files = existsSync(DIR) ? readdirSync(DIR).filter((n) => /\.(hwp|hwpx)$/i.test(n)).sort() : [];

/** 가장 바깥 표 하나에 문단이 1,588개 든 문서(칸 하나에 약 1,300개). 표 안의 글을 편집기에서 선택해 보여 주는 데 13초가 걸린다. */
const GIANT = 'issue1949_giant_cell_nested_tables_perf.hwp';

const kindOf = (name: string): HwpFormat => (name.toLowerCase().endsWith('x') ? 'hwpx' : 'hwp');
const texts = (m: HwpModel): string[] => m.summarize().paragraphs.map((p) => p.text);

describe.skipIf(files.length === 0 && !REQUIRED)('실제 한글 문서(예제 파일)', () => {
  it('예제 문서가 준비되어 있다', () => {
    expect(files.length, `예제 한글 문서를 찾지 못했어요(${DIR}). 한글 편집기를 먼저 빌드하세요(npm run build).`).toBeGreaterThan(0);
  });

  const open = (name: string) => {
    const Doc = loadNodeCore();
    return { Doc, bytes: new Uint8Array(readFileSync(join(DIR, name))), kind: kindOf(name) };
  };

  it.each(files)('%s: 열고, 편집 없이 내보냈다가 다시 읽어도 글이 같다(손실 없음, 표 안의 글 포함)', (name) => {
    const { Doc, bytes, kind } = open(name);
    const model = new HwpModel(new Doc(bytes), kind);
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(texts(new HwpModel(new Doc(out.bytes), kind))).toEqual(texts(model));
  });

  it.each(files)('%s: 표를 빠짐없이 찾는다(코어가 알려 주는 표 개수와 같다)', (name) => {
    const { Doc, bytes, kind } = open(name);
    const doc = new Doc(bytes);
    const known = (JSON.parse(doc.getControls()) as Array<{ ctrlId: string }>).filter((c) => c.ctrlId === 'tbl').length;
    expect(new HwpModel(doc, kind).describeStructure().tables).toBe(known);
  });

  // 글이 전부 표 안에 있는 양식 문서들: 예전에는 읽을 문단이 0개였다.
  const FORMS = ['BlogForm_BookReview.hwp', 'form-002.hwpx', 'issue1949_giant_cell_nested_tables_perf.hwp'].filter((n) => files.includes(n));
  it.each(FORMS)('%s: 표 안의 글을 읽는다(글이 있는 표 칸 문단이 있고, 위치 정보를 가진다)', (name) => {
    const { Doc, bytes, kind } = open(name);
    const s = new HwpModel(new Doc(bytes), kind).summarize();
    const cells = s.paragraphs.filter((p) => p.cell);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((p) => p.text.trim().length > 0 && p.cell && p.cell.row >= 1 && p.cell.col >= 1 && p.cell.table >= 1)).toBe(true);
  });

  it.each(files)('%s: 서식 점검의 제안을 모두 적용하고, 되돌리면 처음 모습이고, 적용한 채 내보내도 글이 같다', async (name) => {
    const { Doc, bytes, kind } = open(name);
    const model = new HwpModel(new Doc(bytes), kind);
    const before = model.summarize();
    const ops = analyzeConsistency(before).findings.flatMap((f) => f.proposal.ops);

    const applied = await model.apply(ops);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true });
    if (!applied.ok) return;

    // 적용한 채 내보내고 다시 읽는다: 손실이 없고 글이 같다.
    const edited = texts(model);
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(texts(new HwpModel(new Doc(out.bytes), kind))).toEqual(edited);

    // 되돌리면 문단의 글과 서식이 처음과 같다. (쪽 수는 비교하지 않는다: 시험 환경(Node)에는 글자 폭을 재는 캔버스가 없어, 고친 뒤 다시 계산하면 근삿값 때문에 달라진다.)
    const back = await model.apply(applied.inverse);
    expect(back.ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  }, 60_000);

  /** 표 칸 문단을 깊이별로 고르게 고른다(깊이마다 최대 perDepth 개, 문서 전체에 걸쳐 고르게). */
  const pickCells = (paragraphs: ParagraphInfo[], perDepth: number): ParagraphInfo[] => {
    const byDepth = new Map<number, ParagraphInfo[]>();
    for (const p of paragraphs) {
      if (!p.cell || [...p.text].length < 4) continue;
      byDepth.set(p.cell.depth, [...(byDepth.get(p.cell.depth) ?? []), p]);
    }
    return [...byDepth.values()].flatMap((list) => {
      const step = Math.max(1, Math.floor(list.length / perDepth));
      return list.filter((_, i) => i % step === 0).slice(0, perDepth);
    });
  };

  /** 고를 문단마다 하는 변경: 글 앞 두 글자 바꾸기, 글자 크기 바꾸기, (본문에 놓인 표의 칸이면) 가운데 정렬을 돌아가며 */
  const opsFor = (picked: ParagraphInfo[]): Op[] =>
    picked.map((p, i): Op => {
      const kind = i % 3;
      if (kind === 0) return { type: 'replaceText', paragraph: p.index, find: [...p.text].slice(0, 2).join(''), replace: 'ZZ', at: 0 };
      if (kind === 1 || p.cell?.depth !== 1) return { type: 'setCharStyle', paragraph: p.index, style: { fontSizePt: 9 } };
      return { type: 'setParaStyle', paragraph: p.index, style: { align: 'center' } };
    });

  it.each(files)('%s: 표 안의 글을 고치고 내보내도 글과 서식이 같고, 되돌리면 처음과 같다', async (name) => {
    const { Doc, bytes, kind } = open(name);
    const model = new HwpModel(new Doc(bytes), kind);
    const before = model.summarize();
    const picked = pickCells(before.paragraphs, 12);
    if (picked.length === 0) return; // 표 안에 글이 없는 문서
    const ops = opsFor(picked);

    const applied = await model.apply(ops);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true });
    if (!applied.ok) return;

    // 고친 모습이 요약에 반영된다.
    const edited = model.summarize();
    for (const p of picked) {
      const now = edited.paragraphs.find((x) => x.index === p.index);
      expect(now, `문단 ${p.index} 가 사라졌어요`).toBeDefined();
      expect(now?.cell).toEqual(p.cell);
    }
    // 파일로 내보내고 다시 읽어도 같다: 손실이 없고, 글·위치·서식이 그대로다.
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    const reopened = new HwpModel(new Doc(out.bytes), kind).summarize();
    expect(reopened.paragraphs).toEqual(edited.paragraphs);

    // 되돌리면 처음과 같다(쪽 수는 비교하지 않는다: 위 시험과 같은 이유).
    const back = await model.apply(applied.inverse);
    expect(back.ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  }, 120_000);

  // 머리말·꼬리말과 각주·미주: 모델이 센 것을 코어를 직접 훑어 센 것(독립된 경로)과 맞춰 본다.
  it.each(files)('%s: 머리말·꼬리말·각주·미주 문단을 빠짐없이 센다(코어를 직접 훑어 센 것과 같다)', (name) => {
    const { Doc, bytes, kind } = open(name);
    const doc = new Doc(bytes);
    const model = new HwpModel(doc, kind);
    const st = model.describeStructure();

    // 머리말·꼬리말: 목록의 각 항목이 담은 문단 수의 합
    const items = (JSON.parse(doc.getHeaderFooterList(0, true, 0)) as { items?: Array<{ sectionIdx: number; isHeader: boolean; applyTo: number }> }).items ?? [];
    const hf = items.reduce((n, it) => n + ((JSON.parse(doc.getHeaderFooter(it.sectionIdx, it.isHeader, it.applyTo)) as { paraCount?: number }).paraCount ?? 0), 0);
    expect(st.headerFooterParagraphs, '머리말·꼬리말 문단 수').toBe(hf);

    // 각주·미주: 모든 본문 문단의 모든 컨트롤을 찔러 보며 센다. 표 안에 달린 것은 getControls() 의 목록 번호(list)가 0 이 아니다.
    let notes = 0;
    for (let sec = 0; sec < doc.getSectionCount(); sec++) {
      for (let p = 0; p < doc.getParagraphCount(sec); p++) {
        const positions = JSON.parse(doc.getControlTextPositions(sec, p)) as unknown[];
        for (let c = 0; c < positions.length; c++) {
          try {
            notes += (JSON.parse(doc.getFootnoteInfo(sec, p, c)) as { paraCount?: number }).paraCount ?? 0;
          } catch {
            // 각주·미주가 아닌 컨트롤
          }
        }
      }
    }
    expect(st.noteParagraphs, '각주·미주 문단 수').toBe(notes);
    const inCells = (JSON.parse(doc.getControls()) as Array<{ ctrlId: string; list: number }>).filter((c) => ['fn', 'en'].includes(c.ctrlId.trim()) && c.list !== 0).length;
    expect(st.unreadableNotes, '읽지 못하는(표 안에 달린) 각주·미주 수').toBe(inCells);
  });

  const NOTES = 'footnote-01.hwp';
  it.skipIf(!files.includes(NOTES))('각주가 든 문서: 본문에 단 각주 8개를 읽고(표 안의 1개는 못 읽는다), 고쳐 내보내도 같고, 되돌리면 처음과 같다', async () => {
    const { Doc, bytes, kind } = open(NOTES);
    const model = new HwpModel(new Doc(bytes), kind);
    const before = model.summarize();
    const notes = before.paragraphs.filter((p) => p.area?.kind === 'footnote');
    expect(notes.map((p) => p.area?.number)).toEqual([1, 2, 4, 5, 6, 7, 8, 9]); // 3번은 표 칸 안에 달려 있다
    expect(model.describeStructure()).toMatchObject({ noteParagraphs: 8, unreadableNotes: 1 });

    const ops: Op[] = notes.map((p) => ({ type: 'replaceText', paragraph: p.index, find: [...p.text.trim()].slice(0, 2).join(''), replace: 'ZZ', guard: textGuard(p.text) }));
    const applied = await model.apply(ops);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true });
    if (!applied.ok) return;
    const edited = model.summarize();
    const editedNotes = edited.paragraphs.filter((p) => p.area?.kind === 'footnote');
    expect(editedNotes.every((p) => p.text.trimStart().startsWith('ZZ'))).toBe(true);
    expect(editedNotes.map((p) => p.area?.number)).toEqual([1, 2, 4, 5, 6, 7, 8, 9]); // 번호는 그대로

    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(new HwpModel(new Doc(out.bytes), kind).summarize().paragraphs).toEqual(edited.paragraphs);

    expect((await model.apply(applied.inverse)).ok).toBe(true);
    expect(model.summarize().paragraphs).toEqual(before.paragraphs);
  });

  // 구역이 셋인 문서(본문 문단 번호를 구역을 이어 붙여 센다)에서 둘째·셋째 구역에 각주와 머리말을 달아, 구역을 맞게 가리키는지 본다.
  const SECTIONS = 'field-01.hwp';
  it.skipIf(!files.includes(SECTIONS))('구역이 여럿인 문서: 둘째 구역의 각주와 셋째 구역의 머리말도 구역을 맞게 가리켜 읽고 고친다', async () => {
    const { Doc, bytes, kind } = open(SECTIONS);
    const built = new Doc(bytes);
    expect(built.getSectionCount()).toBe(3);
    const note = JSON.parse(built.insertFootnote(1, 0, 0)) as { paraIdx: number; controlIdx: number };
    built.insertTextInFootnote(1, note.paraIdx, note.controlIdx, 0, 2, '둘째 구역 각주 몇일');
    built.createHeaderFooter(2, true, 0);
    built.insertTextInHeaderFooter(2, true, 0, 0, 0, '셋째 구역 머리말 오랫만');
    const reopened = new Doc(new Uint8Array(built.exportHwp()));

    const model = new HwpModel(reopened, kind);
    const s = model.summarize();
    const n = s.paragraphs.find((p) => p.text.includes('둘째 구역 각주'));
    const h = s.paragraphs.find((p) => p.text.includes('셋째 구역 머리말'));
    expect(n?.area).toMatchObject({ kind: 'footnote', section: 2 });
    expect(h?.area).toMatchObject({ kind: 'header', section: 3 });

    const r = await model.apply([
      { type: 'replaceText', paragraph: (n as { index: number }).index, find: '몇일', replace: '며칠', guard: textGuard((n as { text: string }).text) },
      { type: 'replaceText', paragraph: (h as { index: number }).index, find: '오랫만', replace: '오랜만', guard: textGuard((h as { text: string }).text) },
    ]);
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
    // 코어를 직접 읽어, 맞는 구역의 글이 고쳐졌는지 확인한다.
    expect((JSON.parse(reopened.getFootnoteInfo(1, note.paraIdx, note.controlIdx)) as { texts: string[] }).texts[0]).toContain('며칠');
    expect((JSON.parse(reopened.getHeaderFooterParaInfo(2, true, 0, 0)) as { text: string }).text).toBe('셋째 구역 머리말 오랜만');
  });

  // 편집기를 표 칸으로 이동시키는 데 걸리는 시간은 가장 바깥 표의 크기에 달려 있다. 실제 편집기(브라우저)에서 재어 보니
  // 이 문서만(가장 바깥 표 하나에 문단 1,588개) 선택하면 13초, 캐럿만 옮겨도 칸에 따라 8초가 걸렸고, 나머지 문서는 표마다 3~22ms 였다. 그 기준이 문서마다 맞게 적용되는지 본다.
  it.each(files)('%s: 표 칸으로 이동하는 위치를 주고, 아주 큰 표에서만 이동하지 않도록 알린다', (name) => {
    const { Doc, bytes, kind } = open(name);
    const model = new HwpModel(new Doc(bytes), kind);
    const picked = pickCells(model.summarize().paragraphs, 6);
    for (const p of picked) {
      const find = [...p.text].slice(1, 4).join('');
      const f = model.cellFocus(p.index, find);
      expect(f, `문단 ${p.index} 의 이동 위치가 없어요`).not.toBeNull();
      expect(f?.position.cellPath === undefined, '안쪽 표 경로는 깊이 2 부터 있다').toBe((p.cell?.depth ?? 0) === 1);
      expect(f?.tooBig === true, `${name} 문단 ${p.index}`).toBe(name === GIANT);
    }
  });

  // 표 하나가 문단 2500개짜리 칸을 가진 문서. 변경마다 쪽 나누기를 다시 계산하면 한 건에 약 0.45초가 걸려 150건이면 70초가 넘는다.
  // 묶음 모드로 끝에 한 번만 계산하면 1초 안팎이다. 느린 환경에서도 구분되도록 넉넉하게 20초를 상한으로 둔다.
  it.skipIf(!files.includes(GIANT))('거대한 표 문서에서도 표 안의 글 150곳을 한 묶음으로 빠르게 고친다', async () => {
    const { Doc, bytes, kind } = open(GIANT);
    const model = new HwpModel(new Doc(bytes), kind);
    const picked = model
      .summarize()
      .paragraphs.filter((p) => p.cell && [...p.text].length >= 4)
      .slice(0, 150);
    expect(picked.length).toBe(150);
    const ops: Op[] = picked.map((p) => ({ type: 'replaceText', paragraph: p.index, find: [...p.text].slice(0, 2).join(''), replace: 'ZZ', at: 0 }));
    const started = performance.now();
    const applied = await model.apply(ops);
    const seconds = (performance.now() - started) / 1000;
    expect(applied.ok).toBe(true);
    expect(seconds, `150건 적용에 ${seconds.toFixed(1)}초 걸렸어요`).toBeLessThan(20);
  }, 120_000);
});
