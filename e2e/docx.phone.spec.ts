import { expect, test } from '@playwright/test';
import { makeDocx } from './docx-fixtures';
import { expectNoHorizontalOverflow, openFile } from './helpers';

/** 손가락으로 누르기 쉬운지: 높이·너비가 모두 이 값 이상이어야 한다. */
const MIN_TOUCH = 36;

// Word(DOCX) 지원을 끄고 빌드한 경우(VITE_DISABLE_DOCX=1)에는 이 시험을 건너뛴다.
test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 지원을 끄고 빌드함');

test.describe('휴대폰 화면: Word(DOCX)', () => {
  test('쪽이 화면 너비에 맞춰 줄고, 가로로 넘치지 않는다', async ({ page }) => {
    await openFile(page, makeDocx());
    await expectNoHorizontalOverflow(page);
    const view = page.viewportSize()!;
    const title = await page.locator('.docx-engine .superdoc-line', { hasText: '업무 협조 요청' }).boundingBox();
    expect(title, '제목 줄이 보이지 않아요').not.toBeNull();
    expect(title!.x).toBeGreaterThanOrEqual(0);
    expect(title!.x + title!.width).toBeLessThanOrEqual(view.width);
    // 문서 영역은 가로로 스크롤되지 않는다(쪽을 감싼 상자만 넘친다).
    expect(await page.locator('.docx-engine').evaluate((el) => getComputedStyle(el).overflowX)).toBe('hidden');
  });

  test('도구줄이 보이고, 도구는 손가락으로 누르기 쉬운 크기이며, 넘치는 도구는 메뉴로 접힌다', async ({ page }) => {
    await openFile(page, makeDocx());
    const items = page.locator('.docx-toolbar .sd-toolbar-item');
    await expect(items.first()).toBeVisible();
    const sizes = await items.evaluateAll((els) =>
      els
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.width > 0)
        .map((r) => ({ w: Math.round(r.width), h: Math.round(r.height) })),
    );
    expect(sizes.length).toBeGreaterThan(3);
    for (const s of sizes) {
      expect(s.w, `도구 너비 ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(MIN_TOUCH);
      expect(s.h, `도구 높이 ${JSON.stringify(s)}`).toBeGreaterThanOrEqual(MIN_TOUCH);
    }
    // 도구줄이 화면 너비를 넘지 않는다.
    const bar = await page.locator('.tools').boundingBox();
    expect(bar!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await expect(page.locator('.docx-toolbar [data-item="btn-overflow"]')).toBeVisible();
  });

  test('아래 막대로 서식 점검 창을 열고 닫는다', async ({ page }) => {
    await openFile(page, makeDocx());
    await expect(page.locator('.pages')).toBeHidden();
    await page.getByRole('button', { name: '서식 점검' }).first().tap();
    await expect(page.getByRole('tab', { name: /서식 점검/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.res li').first()).toContainText('번호 항목(1.) 글자 크기가 다른 곳 1곳');
    await page.getByRole('button', { name: '닫기' }).tap();
    await expect(page.getByTestId('side-panel')).toHaveCSS('visibility', 'hidden');
  });
});
