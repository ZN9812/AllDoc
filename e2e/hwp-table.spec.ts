import { expect, test, type Page } from '@playwright/test';
import { askAi, downloadAs, loginAs, openFile } from './helpers';
import { makeHwpWithBigTable, makeHwpWithTable, readHwp, readHwpCells, TABLE_SAMPLE } from './hwp-fixtures';

// 한글 문서의 표 안의 글(표 안의 표 포함). 시험 문서는 제목, 2x2 표, "홍길동" 칸 안의 작은 표, 맺음 문단으로 이루어진다.
// 오탈자가 바깥 표 칸("몇일", "할려고"), 안쪽 표 칸("오랫만"), 본문("되요")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.

const NATIVE = { hwp: /^HWP로 내려받기/, hwpx: /^HWPX로 내려받기/ } as const;

/** 한글 편집기가 든 iframe 화면 */
const studio = (page: Page) => {
  const frame = page.frames().find((f) => f.url().includes('rhwp-studio'));
  if (!frame) throw new Error('한글 편집기 화면을 찾지 못했어요');
  return frame;
};
/** 편집기가 알려 주는 지금 상태(공개된 자동화 표면): 커서가 표 칸 안인지, 선택한 글이 있는지 */
const editorState = (page: Page) =>
  studio(page).evaluate(() => {
    const c = (window as unknown as { rhwpStudio: { automation: { getContext(): { inTable: boolean; hasSelection: boolean } } } }).rhwpStudio.automation.getContext();
    return { inTable: c.inTable, hasSelection: c.hasSelection };
  });
/** 편집기에서 지금 선택된 글(복사 이벤트로 읽는다. 문서는 바뀌지 않는다) */
const selectedText = (page: Page): Promise<string> =>
  studio(page).evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener('copy', (e) => resolve(e.clipboardData?.getData('text/plain') ?? ''), { once: true });
        document.execCommand('copy');
        setTimeout(() => resolve('(응답 없음)'), 3000);
      }),
  );

test.describe('한글 문서의 표 안의 글', () => {
  for (const format of ['hwp', 'hwpx'] as const) {
    test(`${format.toUpperCase()}: 표 안의 글(표 안의 표 포함)도 AI 가 맞춤법을 제안하고, 카드에 표 위치가 보이고, 전체 적용하면 파일에 반영된다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeHwpWithTable(format));
      expect(TABLE_SAMPLE.cells).toHaveLength(6);

      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      const cards = page.getByTestId('proposal-card');
      await expect(cards).toHaveCount(4);
      const place = (title: string) => cards.filter({ hasText: title }).getByTestId('proposal-place');
      await expect(place('"몇일" 고치기')).toHaveText('표 1 · 2행 2열');
      await expect(place('"할려고" 고치기')).toHaveText('표 1 · 2행 2열');
      await expect(place('"오랫만" 고치기')).toHaveText('표 2 · 1행 2열 (표 안의 표)');
      await expect(place('"되요" 고치기')).toHaveCount(0); // 본문은 표 위치가 없다

      await page.getByRole('button', { name: '전체 적용' }).click();
      await expect(page.locator('.toast').last()).toContainText('4개를 적용했어요');

      const file = await downloadAs(page, NATIVE[format]);
      expect(file.name).toBe(`form_수정본.${format}`);
      expect(readHwpCells(file.bytes)).toEqual(TABLE_SAMPLE.fixedCells);
      expect(readHwp(file.bytes).map((p) => p.text)).toEqual([TABLE_SAMPLE.title, TABLE_SAMPLE.fixedClosing]);
    });
  }

  test('표 안에서 적용한 AI 제안을 되돌리면 파일도 원래대로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithTable('hwp'));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    const applied = readHwpCells((await downloadAs(page, NATIVE.hwp)).bytes);
    expect(applied[5]).toBe('며칠 동안 휴가를 할려고 합니다'); // 이 제안만 적용됨
    expect(applied.slice(0, 5)).toEqual(TABLE_SAMPLE.cells.slice(0, 5));

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect(readHwpCells((await downloadAs(page, NATIVE.hwp)).bytes)).toEqual(TABLE_SAMPLE.cells);
  });

  test('서식 점검(문서 안 일관성)은 표 안의 글을 본문과 비교하지 않는다(칸마다 서식이 다른 건 양식에서 흔하다)', async ({ page }) => {
    // "성명" 칸만 16pt 굵게. 표 안의 글까지 본문과 묶어 비교했다면 "글자 크기가 다른 곳"으로 지적했을 것이다.
    await openFile(page, makeHwpWithTable('hwp', 'form.hwp', { sizes: true }));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 내역에 올리기' })).toBeDisabled();
    await expect(page.getByTestId('coverage-note')).toContainText('본문과 표 안의 글을 다뤄요');
  });

  for (const [title, word] of [
    ['"몇일" 고치기', '몇일'],
    ['"오랫만" 고치기', '오랫만'],
  ] as const) {
    test(`문서에서 보기: 한글 편집기가 그 표 칸(${title === '"오랫만" 고치기' ? '표 안의 표' : '바깥 표'})으로 이동해 고칠 글을 선택한다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeHwpWithTable('hwp'));
      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      expect(await editorState(page)).toEqual({ inTable: false, hasSelection: false });

      await page.getByTestId('proposal-card').filter({ hasText: title }).getByRole('button', { name: '문서에서 보기' }).click();
      await expect.poll(() => editorState(page), { timeout: 15_000 }).toEqual({ inTable: true, hasSelection: true });
      expect(await selectedText(page)).toBe(word); // 칸 안에서 그 글만 선택되어 있다
      // 칸으로 바로 갔으니 "표가 있는 곳으로 이동했다"는 안내는 없다.
      await expect(page.locator('.toast').filter({ hasText: /표 안의 글이에요|이동하지 못했어요|이동만 했어요/ })).toHaveCount(0);
    });
  }

  test('문서에서 보기: 표가 아주 크면(문단 250개 초과) 칸으로 이동하지 않고, 표가 있는 곳으로 이동하며 그렇다고 알려 준다', async ({ page }) => {
    // 편집기가 큰 표 안의 칸으로 이동하면 화면이 몇 초씩 멈춘다(실제 문서로 재어 확인). 그래서 칸으로 가지 않는다.
    await loginAs(page);
    await openFile(page, makeHwpWithBigTable());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' }).getByRole('button', { name: '문서에서 보기' }).click();
    await expect(page.locator('.toast').filter({ hasText: '이 표는 아주 커서' })).toBeVisible({ timeout: 15_000 });
    expect(await editorState(page)).toMatchObject({ inTable: false });
  });

  test('문서에서 보기: 편집기에 이동 함수가 없으면(패치 없이 빌드) 표가 있는 곳으로 이동하고 그렇다고 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithTable('hwp'));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await studio(page).evaluate(() => {
      delete (window as unknown as { __alldocFocusCell?: unknown }).__alldocFocusCell;
    });
    await page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' }).getByRole('button', { name: '문서에서 보기' }).click();
    await expect(page.locator('.toast').filter({ hasText: '표 안의 글이에요' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.toast').filter({ hasText: '이동하지 못했어요' })).toHaveCount(0);
  });
});
