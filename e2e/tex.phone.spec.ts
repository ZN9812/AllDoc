// 휴대폰 화면의 LaTeX 프로젝트: "파일 / 원고 / PDF" 를 바꿔 가며 본다(데모 컴파일러).
import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, loginAs, waitForEngine } from './helpers';

test('휴대폰: 파일·원고·PDF 를 바꿔 보고, 컴파일 결과는 아래에서 올라오는 창으로 본다', async ({ page }) => {
  await loginAs(page);
  await page.goto('/');
  await page.getByRole('button', { name: /한국어 논문\(짧은 글\)/ }).click();
  await waitForEngine(page);
  await expectNoHorizontalOverflow(page);

  // 처음에는 원고만 보인다.
  await expect(page.locator('.tex-source')).toBeVisible();
  await expect(page.locator('.tex-files')).toBeHidden();
  await expect(page.locator('.tex-pdf')).toBeHidden();

  await page.getByRole('tab', { name: '파일' }).click();
  await expect(page.locator('.tex-files')).toBeVisible();
  await expect(page.locator('.tex-source')).toBeHidden();

  await page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '확인하고 컴파일' }).click();
  await expect(page.getByTestId('compile-status')).toHaveText('완료');
  await page.getByRole('tab', { name: 'PDF' }).click();
  await expect(page.locator('.tex-pdf-pages canvas').first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: '컴파일 결과' }).click();
  await expect(page.locator('#pane-compile')).toContainText('PDF를 만들었어요');
  await page.screenshot({ path: test.info().outputPath('tex-phone.png') });
});
