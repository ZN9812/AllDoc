import { expect, test } from '@playwright/test';
import { loginAs, unique } from './helpers';

// 설정 > 계정: 요금제·사용량 표시, 모든 기기에서 로그아웃, 계정 삭제(서버는 AUTH_MODE=dev, DAILY_AI_LIMIT=3)
test.describe('설정의 계정 영역', () => {
  test('로그인하면 요금제와 오늘·이번 달 사용 횟수를 보여 준다', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '계정' })).toBeVisible();
    await expect(page.getByTestId('plan-line')).toHaveText('요금제: 무료 · 오늘 AI 0회 / 3회 · 이번 달 0회');
  });

  test('로그인하지 않으면 계정 영역이 없다', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '화면 색' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '계정' })).toHaveCount(0);
  });

  test('모든 기기에서 로그아웃하면 다른 기기(다른 브라우저 문맥)의 로그인도 풀린다', async ({ page, browser }) => {
    const user = `u-${unique()}`;
    await loginAs(page, user);
    const other = await browser.newContext();
    const otherPage = await other.newPage();
    await loginAs(otherPage, user);
    expect((await (await otherPage.request.get('/api/me')).json()).authenticated).toBe(true);

    await page.goto('/settings');
    await page.getByRole('button', { name: '모든 기기에서 로그아웃' }).click();
    await expect(page.getByText('모든 기기에서 로그아웃했어요.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '계정' })).toHaveCount(0);
    expect((await (await otherPage.request.get('/api/me')).json()).authenticated).toBe(false);
    await other.close();
  });

  test('계정 삭제: 확인 문구를 적어야 지울 수 있고, 지우면 로그인이 풀린다', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings');
    await page.getByRole('button', { name: '계정 삭제' }).click();
    const go = page.getByRole('button', { name: '계정 지우기' });
    await expect(go).toBeDisabled();
    await page.getByLabel('확인 문구').fill('삭제');
    await expect(go).toBeDisabled();
    await page.getByLabel('확인 문구').fill('계정 삭제');
    await go.click();
    await expect(page.getByText('계정을 지웠어요. 이 브라우저의 문서는 그대로 남아 있어요.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '계정' })).toHaveCount(0);
    expect((await (await page.request.get('/api/me')).json()).authenticated).toBe(false);
  });
});
