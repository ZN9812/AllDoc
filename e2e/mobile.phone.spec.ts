import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalOverflow, loginAs, makePdf, openFile, textFile } from './helpers';

const DRAFT = '몇일 뒤에 만나요. 할려고 했어요.\n내일 되요.';

/** 손가락으로 누르기 쉬운지: 높이·너비가 모두 이 값 이상이어야 한다. */
const MIN_TOUCH = 36;

async function expectTouchable(page: Page, name: string | RegExp, role: 'button' | 'link' | 'tab' = 'button'): Promise<void> {
  const box = await page.getByRole(role, { name }).first().boundingBox();
  expect(box, `${String(name)} 가 보이지 않아요`).not.toBeNull();
  expect(box!.height, `${String(name)} 높이`).toBeGreaterThanOrEqual(MIN_TOUCH);
  expect(box!.width, `${String(name)} 너비`).toBeGreaterThanOrEqual(MIN_TOUCH);
}

test.describe('휴대폰 화면', () => {
  test('홈: 가로로 넘치지 않고 주요 버튼이 누르기 쉽다', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.drop')).toBeVisible();
    await expect(page.locator('.search')).toBeHidden(); // 좁은 화면에서는 검색칸을 숨긴다
    await expectNoHorizontalOverflow(page);
    await expectTouchable(page, '파일 선택');
    await expectTouchable(page, '야간 모드');
    await expectTouchable(page, '내 문서', 'link');
  });

  test('가장 좁은 화면(360px)에서도 편집 화면 위쪽 바에 문서 이름이 보인다', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await openFile(page, textFile('아주 긴 이름의 회의록 문서 파일.txt', '내용'));
    await expectNoHorizontalOverflow(page);
    const box = await page.locator('.file-name').boundingBox();
    expect(box!.width).toBeGreaterThan(60);
    await expectTouchable(page, '내려받기');
  });

  test('편집 화면: 문서는 화면 가득, 쪽 목록은 숨고, 아래 막대로 창을 연다', async ({ page }) => {
    await openFile(page, textFile('메모.txt', DRAFT));
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('.pages')).toBeHidden();
    await expect(page.locator('.mbar')).toBeVisible();

    const doc = await page.locator('.text-engine').boundingBox();
    const view = page.viewportSize()!;
    expect(doc!.width).toBeGreaterThan(view.width - 40);

    // 닫혀 있을 때 아래 창은 화면 밖에 있고, 키보드로도 닿지 않는다.
    const closed = await page.getByTestId('side-panel').boundingBox();
    expect(closed!.y).toBeGreaterThanOrEqual(view.height - 2);
    await expect(page.getByTestId('side-panel')).toHaveCSS('visibility', 'hidden');

    await page.getByRole('button', { name: 'AI 대화' }).first().tap();
    await expect(page.getByTestId('side-panel')).toHaveCSS('visibility', 'visible');
    await expect.poll(async () => (await page.getByTestId('side-panel').boundingBox())!.y).toBeLessThan(view.height - 250);
    await expectTouchable(page, '닫기');

    await page.getByRole('button', { name: '닫기' }).tap();
    await expect.poll(async () => (await page.getByTestId('side-panel').boundingBox())!.y).toBeGreaterThanOrEqual(view.height - 2);
  });

  test('아래 창에서 탭을 오가고, Esc 나 닫기로 닫는다', async ({ page }) => {
    await openFile(page, textFile('메모.txt', DRAFT));
    await page.getByRole('button', { name: '서식 점검' }).first().tap();
    await expect(page.getByRole('tab', { name: /서식 점검/ })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: /변경 내역/ }).tap();
    await expect(page.getByText('아직 제안이 없어요')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('side-panel')).toHaveCSS('visibility', 'hidden');
  });

  test('휴대폰에서 AI 제안 → 적용까지', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('메모.txt', DRAFT));
    await page.getByRole('button', { name: 'AI 대화' }).first().tap();
    await page.getByLabel('AI에게 시키기').fill('맞춤법');
    await page.getByRole('button', { name: '보내기' }).tap();
    await page.getByRole('dialog').getByRole('button', { name: '동의하고 계속' }).tap();
    await page.getByRole('button', { name: '변경 내역 보기' }).tap();

    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    await expectTouchable(page, '적용');
    await card.getByRole('button', { name: '적용' }).tap();
    await expect(card).toContainText('적용됨');

    await page.getByRole('button', { name: '닫기' }).tap();
    await expect(page.locator('.text-engine textarea')).toHaveValue(DRAFT.replace('몇일', '며칠'));
    await expect(page.getByRole('button', { name: /변경 내역/ }).last()).toContainText('2'); // 남은 제안 수 배지
  });

  test('목록의 지우기 버튼이 누르기 쉽다', async ({ page }) => {
    await openFile(page, textFile('지울것.txt', '내용'));
    await page.goto('/docs');
    await expectTouchable(page, '지울것.txt 지우기');
  });

  test('PDF: 휴대폰에서 쪽 번호가 아래 막대에 나온다', async ({ page }) => {
    await openFile(page, makePdf(['One', 'Two']));
    await expect(page.locator('.mbar .pgno')).toContainText('쪽');
    await expectNoHorizontalOverflow(page);
  });

  test('설정과 내 문서 화면도 가로로 넘치지 않는다', async ({ page }) => {
    for (const path of ['/docs', '/settings']) {
      await page.goto(path);
      await expectNoHorizontalOverflow(page);
    }
  });
});
