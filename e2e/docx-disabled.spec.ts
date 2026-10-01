import { readdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { makeDocx } from './docx-fixtures';

// VITE_DISABLE_DOCX=1 로 빌드했을 때만 도는 시험(CI 의 "DOCX 없이 빌드" 작업). 평소 빌드에서는 건너뛴다.
test.skip(process.env.VITE_DISABLE_DOCX !== '1', 'DOCX 지원을 끄고 빌드했을 때만 시험한다');

test('DOCX 를 끄고 빌드하면 지원 형식 목록에서 빠지고, DOCX 파일은 안내와 함께 거절한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.drop .s')).toHaveText('HWP · HWPX · PDF · TXT · MD');
  expect(await page.getByTestId('file-input').getAttribute('accept')).not.toContain('.docx');

  await page.setInputFiles('[data-testid=file-input]', makeDocx());
  await expect(page.locator('.toast').last()).toContainText('이 서버에서는 Word(DOCX) 문서를 지원하지 않아요');
  await expect(page).toHaveURL(/\/$/);
});

test('다른 형식은 그대로 열린다(TXT)', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles('[data-testid=file-input]', { name: '메모.txt', mimeType: 'text/plain', buffer: Buffer.from('내용') });
  await page.waitForURL(/\/edit\//);
  await expect(page.locator('.text-engine textarea')).toHaveValue('내용');
});

test('설정 화면의 안내에서도 Word(SuperDoc)가 빠진다', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('한글 문서는 rhwp(MIT), PDF는 pdf.js(Apache-2.0)로 열어요.')).toBeVisible();
  await expect(page.getByText('SuperDoc')).toHaveCount(0);
});

test('빌드 결과에 SuperDoc 과 그 DOCX 엔진이 들어 있지 않다', () => {
  const names = readdirSync('web/dist/assets');
  expect(names.filter((n) => /docx-engine|DocxEngine|worker-entry|superdoc/i.test(n))).toEqual([]);
  expect(names.some((n) => n.startsWith('DocxDisabled'))).toBe(true);
});
