import { expect, test, type Page } from '@playwright/test';
import { loginAs, openFile, textFile } from './helpers';

const DRAFT = '몇일 뒤에 만나요. 할려고 했어요.\n내일 되요.\n정상 문장입니다.';

async function ask(page: Page, text: string): Promise<void> {
  await page.getByRole('tab', { name: /AI 대화/ }).click();
  await page.getByLabel('AI에게 시키기').fill(text);
  await page.getByRole('button', { name: '보내기' }).click();
}

async function agreeIfAsked(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('문서 내용이 AI 서비스로 전송돼요');
  await dialog.getByRole('button', { name: '동의하고 계속' }).click();
}

test.describe('AI 제안 → 적용/취소/되돌리기', () => {
  test('로그인하지 않으면 AI 대신 로그인 안내를 보여 준다', async ({ page }) => {
    await openFile(page, textFile('초안.txt', DRAFT));
    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByText('AI 기능은 로그인 후에 쓸 수 있어요')).toBeVisible();
    await expect(page.getByText('문서는 이 브라우저에만 저장됩니다')).toBeVisible();
    await expect(page.getByLabel('AI에게 시키기')).toHaveCount(0);
  });

  test('처음 쓸 때 동의를 받고, 제안이 변경 내역에 올라온다(문서는 아직 그대로)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법을 확인해 줘');
    await agreeIfAsked(page);

    await expect(page.locator('.bub.demo')).toContainText('데모');
    await expect(page.getByText('데모 AI가 연결되어 있어요')).toBeVisible();
    await expect(page.getByText('오늘 남은 AI 사용 횟수 2/3')).toBeVisible();

    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /변경 내역/ })).toContainText('3');
    // 적용하기 전에는 문서가 바뀌지 않는다.
    await expect(page.locator('.text-engine textarea')).toHaveValue(DRAFT);
    // 고칠 곳(제안 3개가 가리키는 3곳)이 문서 위에 청록색으로 표시된다.
    await expect(page.locator('.text-engine .layer mark')).toHaveCount(3);
  });

  test('카드에 마우스를 올리면 그 곳만 진하게 표시된다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await page.mouse.move(5, 5); // 방금 누른 자리에 카드가 생겨 마우스가 올라가 있을 수 있다.
    await expect(page.locator('.text-engine .layer mark.focus')).toHaveCount(0);
    await page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' }).hover();
    await expect(page.locator('.text-engine .layer mark.focus')).toHaveCount(1);
  });

  test('하나씩 적용하고, 되돌리고, 취소하고, 다시 볼 수 있다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await page.getByRole('button', { name: '변경 내역 보기' }).click();

    const area = page.locator('.text-engine textarea');
    const card = (title: string) => page.getByTestId('proposal-card').filter({ hasText: title });

    await card('"몇일" 고치기').getByRole('button', { name: '적용' }).click();
    await expect(area).toHaveValue(DRAFT.replace('몇일', '며칠'));
    await expect(card('"몇일" 고치기')).toContainText('적용됨');
    await expect(page.locator('.text-engine .layer mark')).toHaveCount(2); // 적용한 곳의 표시는 사라진다

    await card('"몇일" 고치기').getByRole('button', { name: '되돌리기' }).click();
    await expect(area).toHaveValue(DRAFT);
    await expect(card('"몇일" 고치기').getByRole('button', { name: '적용' })).toBeVisible();
    await expect(page.locator('.text-engine .layer mark')).toHaveCount(3);

    await card('"되요" 고치기').getByRole('button', { name: '취소' }).click();
    await expect(card('"되요" 고치기')).toContainText('취소함');
    await expect(page.locator('.text-engine .layer mark')).toHaveCount(2);
    await card('"되요" 고치기').getByRole('button', { name: '다시 보기' }).click();
    await expect(page.locator('.text-engine .layer mark')).toHaveCount(3);
    await expect(card('"되요" 고치기').getByRole('button', { name: '적용' })).toBeVisible();
    await expect(area).toHaveValue(DRAFT);
  });

  test('전체 적용 뒤 저장·내려받기까지 이어진다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();

    const fixed = '며칠 뒤에 만나요. 하려고 했어요.\n내일 돼요.\n정상 문장입니다.';
    await expect(page.locator('.text-engine textarea')).toHaveValue(fixed);
    await expect(page.locator('.toast').last()).toContainText('3개를 적용했어요');
    await expect(page.getByRole('button', { name: '전체 적용' })).toBeDisabled();
    await expect(page.locator('.save-state')).toContainText('저장됨');

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내려받기' }).click()]);
    expect(dl.suggestedFilename()).toBe('초안_수정본.txt');
    await page.reload();
    await expect(page.locator('.text-engine textarea')).toHaveValue(fixed);
  });

  test('문서를 직접 고쳐서 제안이 맞지 않게 되면 적용하지 않고 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await page.getByRole('button', { name: '변경 내역 보기' }).click();

    await page.locator('.text-engine textarea').fill('전혀 다른 글입니다.');
    await page.getByTestId('proposal-card').first().getByRole('button', { name: '적용' }).click();
    await expect(page.getByTestId('proposal-card').first()).toContainText('문서가 바뀌어');
    await expect(page.locator('.text-engine textarea')).toHaveValue('전혀 다른 글입니다.');
  });

  test('동의를 거절하면 AI 에 요청하지 않고 횟수도 쓰지 않는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법');
    await page.getByRole('dialog').getByRole('button', { name: '취소' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByText('오늘 남은 AI 사용 횟수 3/3')).toBeVisible();
    await expect(page.locator('.bub.me')).toHaveCount(0);
  });

  test('동의는 한 번만 묻고, 설정에서 철회하면 다시 묻는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await expect(page.locator('.bub.me')).toHaveCount(1);
    await page.getByLabel('AI에게 시키기').fill('한 번 더');
    await page.getByRole('button', { name: '보내기' }).click();
    await expect(page.locator('.bub.me')).toHaveCount(2);
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.goto('/settings');
    await page.getByRole('button', { name: '동의 철회' }).click();
    await expect(page.getByText('아직 문서 전송 안내에 동의하지 않았어요')).toBeVisible();
  });

  test('하루 한도(3회)를 넘기면 안내하고 더는 보내지 않는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await ask(page, '하나');
    await agreeIfAsked(page);
    for (const t of ['둘', '셋']) {
      await expect(page.getByLabel('AI에게 시키기')).toBeEnabled();
      await page.getByLabel('AI에게 시키기').fill(t);
      await page.getByRole('button', { name: '보내기' }).click();
    }
    await expect(page.getByText('오늘 남은 AI 사용 횟수 0/3')).toBeVisible();
    await page.getByLabel('AI에게 시키기').fill('넷');
    await page.getByRole('button', { name: '보내기' }).click();
    await expect(page.locator('.bub.err')).toContainText('3회');
    await expect(page.locator('.bub.err')).toContainText('내일 0시');
  });

  test('설정에서 AI 기능을 끄면 쓸 수 없다고 안내한다', async ({ page }) => {
    await loginAs(page);
    await page.goto('/settings');
    await page.getByLabel('AI 기능 사용').uncheck();
    await openFile(page, textFile('초안.txt', DRAFT));
    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByText('설정에서 AI 기능이 꺼져 있어요')).toBeVisible();
    await page.getByRole('link', { name: '설정에서 켜기' }).click();
    await expect(page.getByLabel('AI 기능 사용')).not.toBeChecked();
  });

  test('로그아웃하면 다시 로그인 안내가 나온다', async ({ page }) => {
    const name = await loginAs(page, '김철수');
    await page.goto('/');
    await page.getByRole('button', { name: '내 계정' }).click();
    await expect(page.getByRole('menu')).toContainText(name);
    await page.getByRole('menuitem', { name: '로그아웃' }).click();
    await expect(page.getByRole('link', { name: '로그인' })).toBeVisible();
  });

  test('서버에 연결할 수 없어도 편집은 되고, AI 만 안내가 나온다', async ({ page }) => {
    await page.route('**/api/me', (route) => route.abort());
    await openFile(page, textFile('초안.txt', DRAFT));
    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByText('서버에 연결할 수 없어 AI를 쓸 수 없어요')).toBeVisible();
    await page.locator('.text-engine textarea').fill('계속 편집할 수 있어요');
    await expect(page.locator('.save-state')).toContainText('저장됨');
  });

  test('AI 요청이 서버 오류로 실패하면 대화에 이유가 남고 횟수는 그대로다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, textFile('초안.txt', DRAFT));
    await page.route('**/api/ai/propose', (route) =>
      route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { code: 'ai_failed', message: 'AI 서비스가 지금 혼잡해요. 잠시 뒤에 다시 시도해 주세요.' } }) }),
    );
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await expect(page.locator('.bub.err')).toContainText('혼잡해요');
    await expect(page.getByLabel('AI에게 시키기')).toBeEnabled();
  });
  test('"문서에서 보기"를 누르면 긴 글 문서에서도 그 줄로 스크롤한다', async ({ page }) => {
    await loginAs(page);
    const lines = Array.from({ length: 200 }, (_, i) => (i === 190 ? '191번째 줄입니다. 몇일 뒤에 만나요.' : `${i + 1}번째 줄입니다. 특별한 내용이 없는 줄이에요.`));
    await openFile(page, textFile('긴글.txt', lines.join('\n')));
    await ask(page, '맞춤법');
    await agreeIfAsked(page);
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const canvas = page.locator('main.canvas');
    expect(await canvas.evaluate((el) => el.scrollTop)).toBe(0);
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    await card.getByRole('button', { name: '문서에서 보기' }).click();
    await expect.poll(() => canvas.evaluate((el) => el.scrollTop), { timeout: 15_000 }).toBeGreaterThan(1000);
  });
});
