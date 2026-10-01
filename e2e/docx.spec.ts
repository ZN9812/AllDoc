import { expect, test, type Page } from '@playwright/test';
import { makeDocx, readDocx, readDocxPart, SAMPLE_DOCX_PARAS, type ParaSpec } from './docx-fixtures';
import { askAi, downloadAs, fixByRule, loginAs, openFile, unique } from './helpers';

const TEXTS = SAMPLE_DOCX_PARAS.map((p) => p.text);
const doc = (page: Page) => page.locator('.docx-engine');
/** 화면에 그려진 줄(SuperDoc 은 같은 글을 접근성용 숨김 요소에도 두므로 그려진 줄만 고른다) */
const line = (page: Page, text: string) => doc(page).locator('.superdoc-line', { hasText: text });

// Word(DOCX) 지원을 끄고 빌드한 경우(VITE_DISABLE_DOCX=1)에는 이 시험을 건너뛴다.
test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 지원을 끄고 빌드함');

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

  test('고칠 곳이 문서 위에 표시되고, 카드에 마우스를 올리면 진하게 보이며, 적용하면 사라진다', async ({ page }) => {
    await openFile(page, makeDocx());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await page.getByRole('button', { name: '변경 내역에 올리기' }).click();

    const pending = page.locator('.docx-hl-box.pending');
    await expect(pending.first()).toBeVisible();
    // 표시는 "3. 셋째 항목입니다" 줄 위에 겹쳐 있다.
    const target = await line(page, '3. 셋째 항목입니다').boundingBox();
    const box = (await pending.first().boundingBox())!;
    const mid = box.y + box.height / 2;
    expect(mid).toBeGreaterThan(target!.y);
    expect(mid).toBeLessThan(target!.y + target!.height);
    expect(Math.abs(box.x - target!.x)).toBeLessThan(4);

    const card = page.getByTestId('proposal-card').first();
    await card.hover();
    await expect(page.locator('.docx-hl-box.focus').first()).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(page.locator('.docx-hl-box.focus')).toHaveCount(0);

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    await expect(page.locator('.docx-hl-box')).toHaveCount(0);
  });

  test('글을 고치는 제안은 고칠 글만 표시한다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    await card.hover();
    const focus = page.locator('.docx-hl-box.focus');
    await expect(focus.first()).toBeVisible();
    const body = (await line(page, '본문 문장입니다.').boundingBox())!;
    const word = (await focus.first().boundingBox())!;
    expect(word.width).toBeLessThan(60); // 문단 전체(약 600px)가 아니라 "몇일"만
    expect(word.x).toBeGreaterThan(body.x + 80);
  });

  test('제안을 만든 뒤 문서를 직접 고쳐서 맞지 않게 되면 적용하지 않고 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    // 제안이 가리키는 문단을 직접 고친다.
    await line(page, '본문 문장입니다.').click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(' 직접 추가한 글');
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('문서가 바뀌어');
    const body = (await readDocx((await downloadAs(page)).bytes)).at(-1);
    expect(body?.text).toContain('몇일'); // 고치지 않았다
    expect(body?.text).toContain('직접 추가한 글'); // 직접 쓴 글은 그대로
  });

  test('"문서에서 보기"를 누르면 긴 문서에서도 그 곳으로 스크롤한다', async ({ page }) => {
    await loginAs(page);
    const paras: ParaSpec[] = Array.from({ length: 160 }, (_, i) => ({ text: i === 150 ? `${i + 1}번째 문단입니다. 몇일 뒤에 만나요.` : `${i + 1}번째 문단입니다. 특별한 내용이 없는 줄이에요.`, font: '맑은 고딕', sizePt: 10 }));
    await openFile(page, makeDocx('긴문서.docx', paras));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    const engine = doc(page);
    expect(await engine.evaluate((el) => el.scrollTop)).toBe(0);

    await card.getByRole('button', { name: '문서에서 보기' }).click();
    const target = line(page, '151번째 문단입니다');
    await expect(target).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => engine.evaluate((el) => el.scrollTop), { timeout: 15_000 }).toBeGreaterThan(1000);
    // 부드럽게 스크롤하므로 멈출 때까지 기다린 뒤, 문서 영역 안에 들어와 있는지 본다.
    const view = (await engine.boundingBox())!;
    await expect
      .poll(
        async () => {
          const box = await target.boundingBox();
          return box !== null && box.y >= view.y && box.y + box.height <= view.y + view.height;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('AI·서식 점검이 다루는 범위의 한계를 서식 점검 탭에서 알려 준다', async ({ page }) => {
    await openFile(page, makeDocx());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    const note = page.getByTestId('coverage-note');
    await expect(note).toContainText('본문과 표 안의 글을 다뤄요');
    await expect(note).toContainText('머리말·꼬리말, 각주 안의 글은 AI가 읽지 못해요');
    await expect(note).toContainText('첫 글자를 기준으로');
  });

  test('깨진 DOCX 는 알아듣기 쉬운 안내를 보여 준다', async ({ page }) => {
    await openFile(page, { name: `깨짐-${unique()}.docx`, mimeType: 'application/octet-stream', buffer: Buffer.from('이건 Word 파일이 아니에요') }, { ready: false });
    await expect(page.locator('.engine-error')).toContainText('Word(DOCX) 문서가 아니거나 깨져 있어요', { timeout: 30_000 });
  });
});
