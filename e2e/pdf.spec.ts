import { expect, test } from '@playwright/test';
import { makePdf, openFile } from './helpers';

test.describe('PDF 보기', () => {
  test('쪽을 그리고, 쪽 목록·확대·내려받기가 동작한다', async ({ page }) => {
    await openFile(page, makePdf(['First page of the test', 'Second page here']));
    await expect(page.locator('.pdf-engine canvas')).toHaveCount(2);

    // 첫 쪽에 글자가 실제로 그려졌는지(어두운 픽셀이 있는지) 확인한다.
    await page.waitForFunction(() => {
      const c = document.querySelector<HTMLCanvasElement>('.pdf-engine canvas');
      if (!c || !c.width) return false;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 255) < 128) return true;
      return false;
    });

    await expect(page.locator('.pages .pgb')).toHaveCount(2);
    await expect(page.locator('.pages .pgb img').first()).toBeVisible();
    await expect(page.getByText('PDF는 보기만 할 수 있어요')).toBeVisible();

    const before = (await page.locator('.pdf-engine canvas').first().boundingBox())!.width;
    await page.getByRole('button', { name: '확대' }).click();
    await expect.poll(async () => (await page.locator('.pdf-engine canvas').first().boundingBox())!.width).toBeGreaterThan(before);

    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByText('PDF는 글을 고칠 수 없어요')).toBeVisible();

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내려받기' }).click()]);
    expect(dl.suggestedFilename()).toBe('sample.pdf');
  });

  test('쪽 목록에서 쪽을 누르면 현재 쪽 표시가 옮겨진다', async ({ page }) => {
    await openFile(page, makePdf(['One', 'Two', 'Three']));
    await expect(page.locator('.pages .pgb')).toHaveCount(3);
    await page.locator('.pages .pgb').nth(2).click();
    await expect(page.locator('.pages .pgb[aria-current=true]')).toHaveAttribute('aria-label', '3쪽');
  });

  test('깨진 PDF 는 알아듣기 쉬운 안내를 보여 준다', async ({ page }) => {
    await openFile(page, { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nnot a real pdf') }, { ready: false });
    await expect(page.locator('.engine-error')).toContainText('PDF를 열지 못했어요');
  });
});
