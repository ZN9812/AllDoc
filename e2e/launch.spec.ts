import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { LAUNCH_ENV } from './launch-env';
import { unique } from './helpers';

// 출시 준비 설정을 켠 서버(e2e/launch-env.ts, 포트 8796)에서 돈다: 비공개 베타, 하단 사업자 정보, 문의 창구, 정책 문서.

/** 관리자 명령줄 도구를 서버와 같은 설정으로 돌린다 */
function admin(...args: string[]): string {
  return execFileSync('node', ['--disable-warning=ExperimentalWarning', 'server/dist/admin.js', ...args], {
    env: { ...process.env, ...LAUNCH_ENV, NODE_ENV: '' },
    encoding: 'utf8',
  });
}

const me = async (page: Page) => (await (await page.request.get('/api/me')).json()) as { authenticated: boolean };

test.describe('하단 사업자 정보와 정책 문서', () => {
  test('넣은 사업자 정보와 문의 이메일이 하단에 보이고, 넣지 않은 항목은 없다', async ({ page }) => {
    await page.goto('/');
    const footer = page.getByTestId('site-footer');
    await expect(footer.getByTestId('business-info')).toContainText('상호:시험상호');
    await expect(footer.getByTestId('business-info')).toContainText('사업자등록번호:000-00-00000');
    await expect(footer.getByText('통신판매업 신고번호')).toHaveCount(0);
    await expect(footer.getByRole('link', { name: '문의 help@example.com' })).toHaveAttribute('href', 'mailto:help@example.com');
  });

  test('운영자가 넣은 약관은 그대로 보이고(스크립트는 지움), 넣지 않은 환불정책은 준비 중이다', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('site-footer').getByRole('link', { name: '이용약관' }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByTestId('policy-body').getByRole('heading', { name: '시험용 이용약관' })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __policyXss?: boolean }).__policyXss)).toBeUndefined();
    await page.getByTestId('site-footer').getByRole('link', { name: '환불정책' }).click();
    await expect(page.getByTestId('policy-pending')).toHaveText('환불정책은 준비 중이에요.');
  });
});

test.describe('비공개 베타', () => {
  test('초대가 없으면 로그인되지 않고 안내가 나온다', async ({ page }) => {
    const res = await page.request.get(`/api/auth/login?user=${unique()}&next=/`, { maxRedirects: 0 });
    expect(res.headers()['location']).toBe('/?login=invite');
    await page.goto('/?login=invite');
    await expect(page.getByText('비공개 베타 기간이라 초대받은 분만 로그인할 수 있어요.', { exact: false })).toBeVisible();
    expect((await me(page)).authenticated).toBe(false);
  });

  test('관리자가 만든 초대 코드를 로그인 창에 적으면 들어오고, 초대를 거두면 다시 막힌다', async ({ page }) => {
    const out = admin('invite', 'add', 'code', '--uses', '1', '--note', 'e2e');
    const m = /#(\d+) 코드 ([A-Z0-9]{5}-[A-Z0-9]{5})/.exec(out);
    expect(m, out).not.toBeNull();
    const [, id, code] = m as RegExpExecArray;

    await page.goto('/');
    await page.getByRole('button', { name: '로그인' }).click();
    const dialog = page.getByRole('dialog', { name: '비공개 베타 로그인' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'help@example.com' })).toBeVisible();
    await dialog.getByLabel('초대 코드').fill(code.toLowerCase());
    await dialog.getByRole('button', { name: '로그인' }).click();
    await expect(page.getByRole('button', { name: '내 계정' })).toBeVisible();
    expect((await me(page)).authenticated).toBe(true);
    expect(admin('invite', 'list')).toContain(`#${id} 코드 ${code} · 사용 1/1회 · 들어온 계정 1`);

    expect(admin('invite', 'revoke', id)).toContain('계정 1개');
    expect((await me(page)).authenticated).toBe(false);
  });

  test('초대 메일의 링크(/?invite=코드)로 오면 코드가 채워진 로그인 창이 열린다', async ({ page }) => {
    await page.goto('/?invite=ABCDE-23456');
    const dialog = page.getByRole('dialog', { name: '비공개 베타 로그인' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('초대 코드')).toHaveValue('ABCDE-23456');
  });
});
