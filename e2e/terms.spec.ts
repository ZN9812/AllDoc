import { expect, test } from '@playwright/test';
import { loginAs, openFile, textFile } from './helpers';

// 약관 판(TERMS_VERSION)을 켠 두 번째 서버(playwright.config.ts 의 terms 프로젝트)에서 돈다.
test.describe('약관 동의', () => {
  test('로그인하면 동의 창이 저절로 열리고, 미루면 AI 대신 안내가 나오며, 동의하면 AI 를 쓸 수 있다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', '몇일 뒤에 만나요.'));
    const dialog = page.getByRole('dialog', { name: '이용약관 동의' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: '이용약관 보기' })).toHaveAttribute('href', 'https://example.com/terms');
    await dialog.getByRole('button', { name: '나중에' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByText('이용약관에 동의한 뒤에 AI를 쓸 수 있어요.')).toBeVisible();
    await page.getByRole('button', { name: '약관 보고 동의하기' }).click();
    await expect(dialog).toBeVisible();
    const agree = dialog.getByRole('button', { name: '동의', exact: true });
    await expect(agree).toBeDisabled();
    await dialog.getByLabel('만 14세 이상이에요').check();
    await expect(agree).toBeDisabled();
    await dialog.getByLabel('이용약관과 개인정보처리방침에 동의해요').check();
    await agree.click();
    await expect(page.getByText('약관에 동의했어요.')).toBeVisible();
    await expect(page.getByLabel('AI에게 시키기')).toBeVisible();
  });
});
