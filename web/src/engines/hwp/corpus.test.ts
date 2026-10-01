// @vitest-environment node
// 실제 한글 문서(rhwp 저장소가 예제로 두는 파일들)로 읽기·고치기·되돌리기·내보내기를 시험한다.
// 파일은 한글 편집기를 빌드할 때 .cache/rhwp-studio 에 받아진다. 없으면(받지 않은 환경) 건너뛴다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeConsistency } from '../../ai/consistency';
import { HwpModel, type HwpFormat } from './model';
import { loadNodeCore } from './testing';

const DIR = join(__dirname, '../../../../.cache/rhwp-studio/src/rhwp-studio/public/samples');
const files = existsSync(DIR) ? readdirSync(DIR).filter((n) => /\.(hwp|hwpx)$/i.test(n)).sort() : [];

const kindOf = (name: string): HwpFormat => (name.toLowerCase().endsWith('x') ? 'hwpx' : 'hwp');
const texts = (m: HwpModel): string[] => m.summarize().paragraphs.map((p) => p.text);

describe.skipIf(files.length === 0)('실제 한글 문서(예제 파일)', () => {
  const open = (name: string) => {
    const Doc = loadNodeCore();
    return { Doc, bytes: new Uint8Array(readFileSync(join(DIR, name))), kind: kindOf(name) };
  };

  it.each(files)('%s: 열고, 편집 없이 내보냈다가 다시 읽어도 글이 같다(손실 없음)', (name) => {
    const { Doc, bytes, kind } = open(name);
    const model = new HwpModel(new Doc(bytes), kind);
    const out = model.exportBytes();
    expect(out.lossCount).toBe(0);
    expect(texts(new HwpModel(new Doc(out.bytes), kind))).toEqual(texts(model));
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
});
