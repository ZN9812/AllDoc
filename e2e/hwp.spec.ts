import { expect, test, type Page } from '@playwright/test';
import { askAi, downloadAs, fixByRule, loginAs, openFile, unique } from './helpers';
import { makeHwp, makeLongHwp, readHwp, SAMPLE_LINES } from './hwp-fixtures';

const studio = (page: Page) => page.frameLocator('.hwp-host iframe');

test.describe('한글(HWP·HWPX) 문서', () => {
  test('HWP 를 열면 한글 편집기(메뉴·도구줄)와 문서가 보인다', async ({ page }) => {
    await openFile(page, makeHwp('hwp'));
    const iframe = page.locator('.hwp-host iframe');
    await expect(iframe).toHaveAttribute('src', /\/rhwp-studio\/index\.html/);
    await expect(studio(page).locator('#menu-bar')).toBeVisible();
    await expect(studio(page).locator('canvas.document-page-canvas').first()).toBeVisible();
    await expect(studio(page).locator('#sb-message, [id*="message"]').first()).toContainText('sample.hwp');
    await expect(page.locator('.save-state')).toContainText('저장됨');
  });

  test('HWPX 도 열린다', async ({ page }) => {
    await openFile(page, makeHwp('hwpx'));
    await expect(studio(page).locator('#sb-message, [id*="message"]').first()).toContainText('sample.hwpx');
  });

  test('서식 점검: 크기가 다른 번호 항목을 찾아 맞추면 내려받은 파일에 반영된다', async ({ page }) => {
    await openFile(page, makeHwp('hwp'));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.locator('.res li').first()).toContainText('번호 항목(1.) 글자 크기가 다른 곳 1곳');
    await expect(page.locator('.res li').last()).toContainText('번호 체계 이상 없음');

    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();
    const card = page.getByTestId('proposal-card').first();
    await expect(card).toContainText('13pt');
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    await expect(page.locator('.save-state')).toContainText('저장됨');

    const file = await downloadAs(page, /^HWP로 내려받기/);
    expect(file.name).toBe('sample_수정본.hwp');
    const paras = readHwp(file.bytes);
    expect(paras.map((p) => p.sizePt)).toEqual([18, 10, 10, 10, 10]);
    expect(paras.map((p) => p.text)).toEqual(SAMPLE_LINES); // 글은 그대로
  });

  test('적용한 서식 변경을 되돌리면 파일도 원래대로 돌아간다', async ({ page }) => {
    await openFile(page, makeHwp('hwp'));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();
    const card = page.getByTestId('proposal-card').first();
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    const file = await downloadAs(page, /^HWP로 내려받기/);
    expect(readHwp(file.bytes).map((p) => p.sizePt)).toEqual([18, 10, 10, 13, 10]);
  });

  test('AI 제안(맞춤법)을 전체 적용하면 같은 문단의 제안도 모두 적용되고 파일에 반영된다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwp('hwp'));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(2);
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('2개를 적용했어요');

    const file = await downloadAs(page, /^HWP로 내려받기/);
    const last = readHwp(file.bytes).at(-1);
    expect(last?.text).toBe('본문 문장입니다. 며칠 뒤에 만나요. 하려고 했어요.');
  });

  test('HWPX 로 열면 HWPX 로 저장하고, 다른 형식으로 변환해 내려받을 수도 있다', async ({ page }) => {
    await openFile(page, makeHwp('hwpx'));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();
    await page.getByTestId('proposal-card').first().getByRole('button', { name: '적용' }).click();
    await expect(page.getByTestId('proposal-card').first()).toContainText('적용됨');

    const hwpx = await downloadAs(page, /^HWPX로 내려받기/);
    expect(hwpx.name).toBe('sample_수정본.hwpx');
    expect(readHwp(hwpx.bytes).map((p) => p.sizePt)).toEqual([18, 10, 10, 10, 10]);

    const converted = await downloadAs(page, /^HWP\(변환\)으로 내려받기/);
    expect(converted.name).toBe('sample_수정본.hwp');
    expect(readHwp(converted.bytes).map((p) => p.sizePt)).toEqual([18, 10, 10, 10, 10]);
  });

  test('편집기에서 직접 고친 글을 AI 가 읽는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwp('hwp'));
    const frame = studio(page);
    // 문서 끝에 오탈자를 직접 입력한다.
    await frame.locator('canvas.document-page-canvas').first().click({ position: { x: 300, y: 200 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 오랫만이에요');
    await expect(page.locator('.save-state')).toContainText('저장됨');
    await expect.poll(async () => (await page.locator('.save-state').innerText()).includes('저장 중')).toBe(false);

    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await expect(page.getByTestId('proposal-card').filter({ hasText: '"오랫만" 고치기' })).toBeVisible();
  });

  test('편집기에서 고친 내용은 자동 저장되어 새로고침해도 남는다', async ({ page }) => {
    await openFile(page, makeHwp('hwp'));
    const frame = studio(page);
    await frame.locator('canvas.document-page-canvas').first().click({ position: { x: 300, y: 200 } });
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 추가한 글');
    await expect.poll(async () => (await page.locator('.save-state').innerText()).includes('저장됨')).toBe(true);
    await page.waitForTimeout(2500); // 변경 감지(1초 간격)와 저장(0.8초 뒤)이 끝날 때까지
    await page.reload();
    await expect(page.getByRole('button', { name: '내려받기' })).toBeEnabled({ timeout: 30_000 });
    const file = await downloadAs(page, /^HWP로 내려받기/);
    expect(readHwp(file.bytes).at(-1)?.text).toContain('추가한 글');
  });

  test('내 규칙: 글자 크기를 한꺼번에 맞추면 내려받은 파일에 반영되고, 되돌릴 수 있다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwp('hwp'));
    await fixByRule(page, '모든 글자는 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '글자 크기를 12pt로' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    expect(readHwp((await downloadAs(page, /^HWP로 내려받기/)).bytes).map((p) => p.sizePt)).toEqual([12, 12, 12, 12, 12]);

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect(readHwp((await downloadAs(page, /^HWP로 내려받기/)).bytes).map((p) => p.sizePt)).toEqual([18, 10, 10, 13, 10]);
  });

  test('내 규칙: 글꼴을 바꾸면 모든 언어 칸이 바뀌어 파일에 반영되고, 되돌리면 처음 글꼴로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwp('hwp'));
    const original = readHwp((await downloadAs(page, /^HWP로 내려받기/)).bytes)[0]!.fonts;
    expect(original).toHaveLength(7);
    expect(new Set(original)).not.toContain('함초롬돋움'); // 처음에는 다른 글꼴이다

    await fixByRule(page, '본문은 함초롬돋움');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '글꼴을 함초롬돋움' });
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    const changed = readHwp((await downloadAs(page, /^HWP로 내려받기/)).bytes);
    for (const p of changed) expect(p.fonts, p.text).toEqual(Array(7).fill('함초롬돋움'));

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect(readHwp((await downloadAs(page, /^HWP로 내려받기/)).bytes)[0]!.fonts).toEqual(original);
  });

  test('"문서에서 보기"를 누르면 한글 편집기가 그 문단이 있는 쪽으로 이동한다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeLongHwp());
    const scrollTop = () => page.frames().find((f) => f.url().includes('rhwp-studio'))!.evaluate(() => document.querySelector('#scroll-container')?.scrollTop ?? -1);
    expect(await scrollTop()).toBe(0);
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    await card.getByRole('button', { name: '문서에서 보기' }).click();
    await expect.poll(scrollTop, { timeout: 15_000 }).toBeGreaterThan(5000);
  });

  test('AI·서식 점검이 다루는 범위의 한계(글상자·표 안의 각주 등)를 서식 점검 탭에서 알려 준다', async ({ page }) => {
    await openFile(page, makeHwp('hwp'));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    const note = page.getByTestId('coverage-note');
    await expect(note).toContainText('본문, 표 안의 글, 머리말·꼬리말, 각주·미주, 글상자를 다뤄요');
    await expect(note).toContainText('표 안에 달린 각주, 머리말·꼬리말 안의 글상자, 묶음(그리기) 개체 안의 글상자는 AI가 읽지 못해요');
    await expect(note).toContainText('서식 점검(문서 안 일관성·기준 문서)은 본문(표 밖)만 비교');
  });

  test('깨진 한글 파일은 알아듣기 쉬운 안내를 보여 준다', async ({ page }) => {
    await openFile(page, { name: `깨짐-${unique()}.hwp`, mimeType: 'application/octet-stream', buffer: Buffer.from('이건 한글 파일이 아니에요') }, { ready: false });
    await expect(page.locator('.engine-error')).toContainText('한글 편집기를 열지 못했어요', { timeout: 30_000 });
  });

  test('야간 모드를 켜 두었다면 편집기도 어두운 화면으로 열린다', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '야간 모드' }).click();
    await openFile(page, makeHwp('hwp'));
    await expect.poll(async () => page.locator('.hwp-host iframe').evaluate((f) => (f as HTMLIFrameElement).contentDocument?.documentElement.dataset.themeEffective)).toBe('dark');
  });
});
