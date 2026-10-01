import { expect, test, type Page } from '@playwright/test';
import { makeDocx, readDocx, readDocxPart, SAMPLE_DOCX_PARAS } from './docx-fixtures';
import { askAi, downloadAs, loginAs, openFile, unique } from './helpers';

const TEXTS = SAMPLE_DOCX_PARAS.map((p) => p.text);
const doc = (page: Page) => page.locator('.docx-engine');
/** 화면에 그려진 줄(SuperDoc 은 같은 글을 접근성용 숨김 요소에도 두므로 그려진 줄만 고른다) */
const line = (page: Page, text: string) => doc(page).locator('.superdoc-line', { hasText: text });

/** 서식 점검 탭에서 "내 규칙"으로 AI 에게 고치게 한다(처음이면 동의 창에 동의). */
async function fixByRule(page: Page, rule: string): Promise<void> {
  await page.getByRole('tab', { name: /서식 점검/ }).click();
  await page.getByRole('radio', { name: /내 규칙/ }).check();
  await page.getByLabel('내 규칙', { exact: true }).fill(rule);
  await page.getByRole('button', { name: 'AI로 고치기' }).click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '동의하고 계속' }).click();
}

test.describe('Word(DOCX) 문서', () => {
  test('DOCX 를 열면 Word 편집기(도구줄)와 문서 내용이 보인다', async ({ page }) => {
    await openFile(page, makeDocx());
    await expect(line(page, '업무 협조 요청')).toBeVisible();
    await expect(line(page, '3. 셋째 항목입니다')).toBeVisible();
    // 도구줄이 편집 화면 위쪽 도구줄 칸에 들어가 있다.
    await expect(page.locator('.tools .docx-toolbar [data-item="btn-bold"]')).toBeVisible();
    await expect(page.locator('.save-state')).toContainText('저장됨');
  });

  test('도구줄 이름은 한국어로 보인다', async ({ page }) => {
    await openFile(page, makeDocx());
    await page.locator('.tools .docx-toolbar [data-item="btn-bold"]').hover();
    await expect(page.locator('.sd-editor-toolbar-tooltip').filter({ hasText: '굵게' })).toBeVisible();
  });

  test('서식 점검: 크기가 다른 번호 항목을 찾아 맞추면 내려받은 파일에 반영된다', async ({ page }) => {
    await openFile(page, makeDocx());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.locator('.res li').first()).toContainText('번호 항목(1.) 글자 크기가 다른 곳 1곳');
    await expect(page.locator('.res li').last()).toContainText('번호 체계 이상 없음');

    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();
    const card = page.getByTestId('proposal-card').first();
    await expect(card).toContainText('13pt');
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');

    const file = await downloadAs(page);
    expect(file.name).toBe('sample_수정본.docx');
    const paras = await readDocx(file.bytes);
    expect(paras.map((p) => p.text)).toEqual(TEXTS); // 글은 그대로
    expect(paras.map((p) => p.sizes[0])).toEqual([18, 10, 10, 10, 10]);
    expect(paras[0]).toMatchObject({ bold: true, align: 'center' }); // 제목의 다른 서식은 그대로
    expect(paras[4]).toMatchObject({ align: 'both', linePct: 160 });
  });

  test('적용한 서식 변경을 되돌리면 파일도 원래대로 돌아간다', async ({ page }) => {
    await openFile(page, makeDocx());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();
    const card = page.getByTestId('proposal-card').first();
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();

    const paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.map((p) => p.sizes[0])).toEqual([18, 10, 10, 13, 10]);
  });

  test('내 규칙: 글꼴·크기·줄 간격을 한꺼번에 맞추고, 하나씩 되돌릴 수 있다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx());
    await fixByRule(page, '본문은 함초롬바탕 11pt, 줄 간격 180%');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(3);
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('3개를 적용했어요');

    let paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.map((p) => p.text)).toEqual(TEXTS);
    expect(paras.map((p) => p.fonts[0])).toEqual(Array(5).fill('함초롬바탕'));
    expect(paras.map((p) => p.sizes[0])).toEqual(Array(5).fill(11));
    expect(paras[4]?.linePct).toBe(180);
    expect(paras[0]).toMatchObject({ bold: true, align: 'center' });
    expect(paras[4]?.align).toBe('both');

    // 글꼴만 되돌린다.
    const fontCard = page.getByTestId('proposal-card').filter({ hasText: '글꼴을' });
    await fontCard.getByRole('button', { name: '되돌리기' }).click();
    await expect(fontCard.getByRole('button', { name: '적용' })).toBeVisible();
    paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.map((p) => p.fonts[0])).toEqual(Array(5).fill('맑은 고딕'));
    expect(paras.map((p) => p.sizes[0])).toEqual(Array(5).fill(11));
    expect(paras[4]?.linePct).toBe(180);
  });

  test('AI 제안(맞춤법)을 전체 적용하면 글만 바뀌고 서식은 그대로 남는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(2);
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('2개를 적용했어요');

    const paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.at(-1)?.text).toBe('본문 문장입니다. 며칠 뒤에 만나요. 하려고 했어요.');
    expect(paras.map((p) => p.text).slice(0, 4)).toEqual(TEXTS.slice(0, 4));
    expect(paras.at(-1)).toMatchObject({ sizes: expect.arrayContaining([10]), align: 'both', linePct: 160 });
    await expect(line(page, '본문 문장입니다. 며칠 뒤에 만나요. 하려고 했어요.')).toBeVisible();
  });

  test('표 칸 안의 글도 AI 가 고칠 수 있다', async ({ page }) => {
    await loginAs(page);
    await openFile(
      page,
      makeDocx('표.docx', [
        { text: '표 앞 문단', font: '맑은 고딕', sizePt: 10 },
        [
          ['항목', '내용'],
          ['기간', '몇일 뒤'],
        ],
        { text: '표 뒤 문단', font: '맑은 고딕', sizePt: 10 },
      ]),
    );
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await page.getByTestId('proposal-card').first().getByRole('button', { name: '적용' }).click();
    await expect(page.getByTestId('proposal-card').first()).toContainText('적용됨');
    const paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.map((p) => p.text)).toEqual(['표 앞 문단', '항목', '내용', '기간', '며칠 뒤', '표 뒤 문단']);
  });

  test('편집기에서 직접 고친 글을 AI 가 읽고, 고친 내용은 자동 저장되어 새로고침해도 남는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx());
    await line(page, '본문 문장입니다.').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' 오랫만이에요');
    await expect.poll(async () => (await page.locator('.save-state').innerText()).includes('저장됨')).toBe(true);
    await page.waitForTimeout(1500); // 변경 감지와 저장(0.8초 뒤)이 끝날 때까지

    await page.reload();
    await expect(page.getByRole('button', { name: '내려받기' })).toBeEnabled({ timeout: 30_000 });
    await expect(line(page, '오랫만이에요')).toBeVisible();

    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await expect(page.getByTestId('proposal-card').filter({ hasText: '"오랫만" 고치기' })).toBeVisible();
    const paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.at(-1)?.text).toContain('오랫만이에요');
  });

  test('댓글이 있는 문서: 쪽이 줄어들지 않고, 글을 누르면 댓글이 보이며, 고쳐서 내려받아도 댓글이 남는다', async ({ page }) => {
    const COMMENT = '이 항목은 더 구체적으로 써 주세요.';
    await openFile(page, makeDocx('댓글.docx', SAMPLE_DOCX_PARAS.map((p, i) => (i === 1 ? { ...p, comment: { text: COMMENT } } : p))));
    // 댓글 때문에 옆 칸이 생겨 쪽이 줄거나 잘리지 않는다(본문 너비 약 600px).
    const title = await line(page, '업무 협조 요청').boundingBox();
    expect(title!.width).toBeGreaterThan(500);
    const engine = await doc(page).boundingBox();
    expect(title!.x + title!.width).toBeLessThanOrEqual(engine!.x + engine!.width);

    await line(page, '1. 첫째 항목입니다').click({ position: { x: 40, y: 5 } });
    await expect(page.getByText(COMMENT)).toBeVisible();

    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();
    const card = page.getByTestId('proposal-card').first();
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');

    const file = await downloadAs(page);
    expect((await readDocx(file.bytes)).map((p) => p.sizes[0])).toEqual([18, 10, 10, 10, 10]);
    expect(await readDocxPart(file.bytes, 'word/comments.xml')).toContain(COMMENT);
  });

  test('깨진 DOCX 는 알아듣기 쉬운 안내를 보여 준다', async ({ page }) => {
    await openFile(page, { name: `깨짐-${unique()}.docx`, mimeType: 'application/octet-stream', buffer: Buffer.from('이건 Word 파일이 아니에요') }, { ready: false });
    await expect(page.locator('.engine-error')).toContainText('Word(DOCX) 문서가 아니거나 깨져 있어요', { timeout: 30_000 });
  });
});
