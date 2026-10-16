import { expect, test, type Page } from '@playwright/test';
import { makeDocx } from './docx-fixtures';
import { loginAs, openFile, textFile, waitForEngine } from './helpers';
import { makeHwp } from './hwp-fixtures';

// 사내망 http 주소(예: http://192.168.0.10:8787)처럼 "안전하지 않은 주소"에서는 브라우저가 crypto.randomUUID 와 crypto.subtle 을 주지 않는다.
// 같은 상태를 만들어(페이지와 iframe 에 적용된다) 문서가 열리는지 본다. 웹 워커 안은 흉내 내지 못하므로, 실제 http 주소에서의 확인은 docs/DEPLOY.md 에 적었다.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const name of ['randomUUID', 'subtle']) Object.defineProperty(Crypto.prototype, name, { value: undefined, configurable: true });
  });
});

const lacksSecureCrypto = (page: Page) => page.evaluate(() => typeof crypto.randomUUID === 'undefined' && typeof crypto.subtle === 'undefined');

test.describe('안전하지 않은 주소(crypto.randomUUID·subtle 없음)에서도 문서가 열린다', () => {
  test('TXT', async ({ page }) => {
    await openFile(page, textFile('사내.txt', '첫 줄'));
    expect(await lacksSecureCrypto(page)).toBe(true);
    await expect(page.locator('.text-engine textarea')).toHaveValue('첫 줄');
  });

  test('HWP: 편집기 화면(iframe)까지 열린다', async ({ page }) => {
    await openFile(page, makeHwp());
    expect(await lacksSecureCrypto(page)).toBe(true);
    const studio = page.frames().find((f) => f.url().includes('/rhwp-studio/'));
    expect(studio, '한글 편집기 화면이 열려야 한다').toBeTruthy();
    expect(await studio!.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
  });

  test('DOCX', async ({ page }) => {
    test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 지원을 끄고 빌드함');
    await openFile(page, makeDocx());
    expect(await lacksSecureCrypto(page)).toBe(true);
  });

  test('LaTeX: 템플릿으로 만들고 컴파일한다(서버가 파일 해시를 다시 계산해 대조한다)', async ({ page }) => {
    await loginAs(page);
    await page.goto('/');
    await page.getByRole('button', { name: /한국어 보고서·학위논문 초안/ }).click();
    await page.waitForURL(/\/edit\//);
    await waitForEngine(page);
    expect(await lacksSecureCrypto(page)).toBe(true);

    await page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '확인하고 컴파일' }).click();
    await expect(page.getByTestId('compile-status')).toHaveText('완료');
    await expect(page.locator('.tex-pdf-pages canvas').first()).toBeVisible({ timeout: 15_000 });
  });
});
