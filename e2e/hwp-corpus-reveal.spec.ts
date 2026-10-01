// 실제 한글 문서(rhwp 저장소가 예제로 두는 파일들)의 표 칸으로 "문서에서 보기"가 이동하는지 시험한다.
// 한글 편집기에 빌드 때 끼워 넣은 이동 함수(web/scripts/build-rhwp-studio.mjs 의 패치)가 문서마다·깊이마다 맞게 이동하는지를 본다.
// 확인하는 것: 이동 뒤 선택된 글이 가리킨 글과 같고, 선택 표시가 편집기의 보이는 영역 안에 있다.
// 예제 파일은 한글 편집기를 빌드할 때 .cache 에 받아진다. 없으면 건너뛰고, REQUIRE_HWP_SAMPLES=1 이면(CI) 건너뛰지 않고 실패한다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { HwpModel, type CellFocus } from '../web/src/engines/hwp/model';
import { loadNodeCore } from '../web/src/engines/hwp/testing';
import { openFile } from './helpers';

const DIR = process.env.RHWP_SAMPLES_DIR || join(dirname(fileURLToPath(import.meta.url)), '../.cache/rhwp-studio/src/rhwp-studio/public/samples');
const REQUIRED = process.env.REQUIRE_HWP_SAMPLES === '1';
const files = existsSync(DIR) ? readdirSync(DIR).filter((n) => /\.(hwp|hwpx)$/i.test(n)).sort() : [];

/** 가장 바깥 표 하나에 문단이 1,588개 든 문서. 칸으로 이동하면 화면이 오래 멈추므로 이동하지 않는 것이 맞다(model.ts MAX_FOCUS_TABLE_PARAGRAPHS). */
const GIANT = 'issue1949_giant_cell_nested_tables_perf.hwp';
const PER_DEPTH = 4;
const squash = (s: string): string => s.replace(/\s+/g, '');

test.describe('실제 한글 문서의 표 칸으로 이동', () => {
  test('예제 문서가 준비되어 있다', () => {
    test.skip(files.length === 0 && !REQUIRED, '예제 한글 문서를 받지 않은 환경');
    expect(files.length, `예제 한글 문서를 찾지 못했어요(${DIR}). 한글 편집기를 먼저 빌드하세요(npm run build).`).toBeGreaterThan(0);
  });

  for (const name of files) {
    test(`${name}: 깊이별로 고른 표 칸으로 이동해 가리킨 글을 선택한다`, async ({ page }) => {
      test.setTimeout(120_000);
      const bytes = new Uint8Array(readFileSync(join(DIR, name)));
      const Doc = loadNodeCore();
      const model = new HwpModel(new Doc(bytes), name.toLowerCase().endsWith('x') ? 'hwpx' : 'hwp');
      // 글이 있는 칸 문단을 깊이(1·2·3)마다 문서 전체에 걸쳐 고르게 고른다. 여러 칸이 한 줄에 같은 글이 겹치지 않게 연속된 공백이 있는 글은 뺀다.
      const cells = model.summarize().paragraphs.filter((p) => p.cell && [...p.text.trim()].length >= 3 && !/\s{2}/.test(p.text));
      test.skip(cells.length === 0, '표 안에 글이 없는 문서');
      const picked = [1, 2, 3].flatMap((depth) => {
        const list = cells.filter((p) => p.cell?.depth === depth);
        const step = Math.max(1, Math.floor(list.length / PER_DEPTH));
        return list.filter((_, i) => i % step === 0).slice(0, PER_DEPTH);
      });

      const targets = picked.map((p) => {
        const chars = [...p.text];
        const from = Math.floor(chars.length / 3);
        const find = chars.slice(from, from + Math.min(4, chars.length - from)).join('');
        return { depth: p.cell?.depth ?? 0, find, focus: model.cellFocus(p.index, find) as CellFocus };
      });
      for (const t of targets) expect(t.focus, `이동 위치가 없어요: ${t.find}`).not.toBeNull();

      if (name === GIANT) {
        // 이 문서는 이동하지 않는 것이 맞다. (실제로 이동하면 선택 표시에 13초, 캐럿만 옮겨도 최대 8초가 걸린다.)
        expect(targets.every((t) => t.focus.tooBig === true)).toBe(true);
        return;
      }
      expect(targets.every((t) => t.focus.tooBig !== true)).toBe(true);

      await openFile(page, { name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
      const frame = page.frames().find((f) => f.url().includes('rhwp-studio'));
      if (!frame) throw new Error('한글 편집기 화면을 찾지 못했어요');

      for (const t of targets) {
        const got = await frame.evaluate(
          async ({ position, end }) => {
            const move = (window as unknown as { __alldocFocusCell?: (p: unknown, e?: number) => boolean }).__alldocFocusCell;
            if (typeof move !== 'function' || move(position, end) !== true) return { moved: false, text: '', inView: false };
            // 선택한 글을 복사 이벤트로 읽는다(문서는 바뀌지 않는다).
            const text = await new Promise<string>((resolve) => {
              document.addEventListener('copy', (e) => resolve(e.clipboardData?.getData('text/plain') ?? ''), { once: true });
              document.execCommand('copy');
              setTimeout(() => resolve('(응답 없음)'), 3000);
            });
            await new Promise((r) => setTimeout(r, 200));
            const view = document.getElementById('scroll-container')?.getBoundingClientRect();
            const marks = Array.from(document.querySelectorAll('.selection-highlight')).map((e) => e.getBoundingClientRect());
            const inView =
              view !== undefined &&
              marks.length > 0 &&
              marks.every((b) => b.width > 0 && b.height > 0 && b.top >= view.top - 1 && b.bottom <= view.bottom + 1 && b.left >= view.left - 1 && b.right <= view.right + 1);
            return { moved: true, text, inView };
          },
          { position: t.focus.position, end: t.focus.end },
        );
        const label = `깊이 ${t.depth} "${t.find}"`;
        expect(got.moved, `${label}: 이동하지 못했어요`).toBe(true);
        expect(squash(got.text), `${label}: 선택된 글이 달라요`).toBe(squash(t.find));
        expect(got.inView, `${label}: 선택 표시가 보이는 영역 밖이에요`).toBe(true);
      }
    });
  }
});
