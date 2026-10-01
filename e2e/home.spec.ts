import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, openFile, textFile } from './helpers';

test.describe('홈과 내 문서', () => {
  test('첫 화면: 끌어다 놓는 칸과 비어 있는 최근 문서', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.drop')).toBeVisible();
    await expect(page.getByRole('button', { name: '파일 선택' })).toBeVisible();
    await expect(page.locator('.nav a')).toHaveText(['새 문서', '내 문서', '설정']);
    await expect(page.getByText('아직 연 문서가 없어요')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('지원하지 않는 파일은 이유를 알려 주고 홈에 머무른다', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('[data-testid=file-input]', { name: '표.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('x') });
    await expect(page.locator('.toast').first()).toContainText('.xlsx 형식은 아직 열 수 없어요');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('빈 파일은 거절한다', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('[data-testid=file-input]', { name: '빈.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
    await expect(page.locator('.toast').first()).toContainText('빈 파일');
  });

  test('끌어다 놓으면 칸이 강조되고, 놓은 파일이 열린다(여러 파일이면 첫 번째만)', async ({ page }) => {
    await page.goto('/');
    await page.dispatchEvent('.drop', 'dragenter');
    await expect(page.locator('.drop.hot')).toBeVisible();
    await page.dispatchEvent('.drop', 'dragleave');
    await expect(page.locator('.drop.hot')).toHaveCount(0);

    const dt = await page.evaluateHandle(() => {
      const d = new DataTransfer();
      d.items.add(new File(['하나'], '첫째.txt', { type: 'text/plain' }));
      d.items.add(new File(['둘'], '둘째.txt', { type: 'text/plain' }));
      return d;
    });
    await page.dispatchEvent('.drop', 'drop', { dataTransfer: dt });
    await page.waitForURL(/\/edit\//);
    await expect(page.locator('.file-name')).toHaveText('첫째.txt');
    await expect(page.locator('.toast').first()).toContainText('한 번에 한 파일만');
  });

  test('올린 문서가 최근 문서와 내 문서에 쌓이고, 검색하고, 지울 수 있다', async ({ page }) => {
    await openFile(page, textFile('회의록 9월.txt', '내용'));
    await page.goto('/');
    await expect(page.locator('.recent .nm').first()).toHaveText('회의록 9월.txt');
    await page.fill('.search input', '없는문서');
    await expect(page.getByText('에 맞는 문서가 없어요')).toBeVisible();
    await page.fill('.search input', '회의');
    await expect(page.locator('.recent .row')).toHaveCount(1);

    await page.getByRole('link', { name: '내 문서' }).click();
    await expect(page.getByRole('heading', { name: '내 문서' })).toBeVisible();
    await page.getByRole('button', { name: '회의록 9월.txt 지우기' }).click();
    await expect(page.getByText('저장된 문서가 없어요')).toBeVisible();
  });

  test('목록에서 문서를 누르면 다시 열린다', async ({ page }) => {
    await openFile(page, textFile('다시열기.txt', '다시 열 내용'));
    await page.goto('/');
    await page.locator('.recent .open').first().click();
    await expect(page.locator('.text-engine textarea')).toHaveValue('다시 열 내용');
  });

  test('로그인에 실패해 돌아오면 한 번 알리고 주소를 정리한다', async ({ page }) => {
    await page.goto('/?login=failed');
    await expect(page.locator('.toast').first()).toContainText('로그인하지 못했어요');
    await expect(page).toHaveURL(/\/$/);
  });

  test('없는 문서와 없는 주소는 안내한다', async ({ page }) => {
    await page.goto('/edit/does-not-exist');
    await expect(page.locator('.engine-error')).toContainText('문서를 찾을 수 없어요');
    await page.goto('/no/such/page');
    await expect(page.locator('.engine-error')).toContainText('찾을 수 없는 페이지');
  });
});

test.describe('화면 색(야간 모드)과 설정', () => {
  test('야간 모드로 바꾸면 새로고침해도 유지된다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const toggle = page.getByRole('button', { name: '야간 모드' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('밝은 화면');
  });

  test('설정에서 밝게·어둡게·기기 설정 따르기를 고른다', async ({ page }) => {
    await page.goto('/settings');
    await page.getByLabel('어둡게').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('밝게').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByLabel('기기 설정 따르기').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('설정에서 저장된 문서를 모두 지운다', async ({ page }) => {
    await openFile(page, textFile('지울문서.txt', 'x'));
    await page.goto('/settings');
    await expect(page.getByText(/문서 \d+개가 저장되어 있어요/)).toBeVisible();
    await page.getByRole('button', { name: '저장된 문서 모두 지우기' }).click();
    await page.getByRole('button', { name: '모두 지우기' }).click();
    await expect(page.getByText('문서 0개가 저장되어 있어요')).toBeVisible();
  });

  test('소스 코드 주소(AGPL)를 보여 준다', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('link', { name: /github\.com/ })).toBeVisible();
  });
});
