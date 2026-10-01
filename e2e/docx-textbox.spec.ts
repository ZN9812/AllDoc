import { expect, test, type Page } from '@playwright/test';
import { DOCX_BOX_SAMPLE, makeDocxWithBoxes, makeDocxWithHeaderBox, makeDocxWithLegacyBox, readDocxBody, readDocxBoxTexts, readDocxBoxes, readDocxPart } from './docx-fixtures';
import { askAi, downloadAs, fixByRule, loginAs, openFile } from './helpers';

// Word 문서의 글상자. 시험 문서는 글상자 1(문단 둘, 본문 문단에 놓임), 글상자 2(표 칸 안의 문단에 놓임), 본문 문단으로 이루어진다.
// 오탈자가 글상자 1 의 첫 문단("몇일")·둘째 문단("할려고"), 글상자 2("되요"), 본문("오랫만")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.
// 글상자는 Word·LibreOffice 처럼 그림 방식과 옛 방식 두 벌로 저장되어 있고, 편집기는 그림 방식 쪽을 읽고 고친다.

// Word(DOCX) 지원을 끄고 빌드한 경우(VITE_DISABLE_DOCX=1)에는 이 시험을 건너뛴다.
test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 지원을 끄고 빌드함');

const FIXED = DOCX_BOX_SAMPLE.fixed;
const doc = (page: Page) => page.locator('.docx-engine');

test.describe('Word 문서의 글상자', () => {
  test('AI 가 글상자 안의 글도 맞춤법을 제안하고, 카드에 글상자 위치가 보이고, 전체 적용하면 파일의 글상자(그림 방식·옛 방식 모두)에 반영된다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithBoxes());

    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(4);
    const place = (title: string) => cards.filter({ hasText: title }).getByTestId('proposal-place');
    await expect(place('"몇일" 고치기')).toHaveText('글상자 1');
    await expect(place('"할려고" 고치기')).toHaveText('글상자 1');
    await expect(place('"되요" 고치기')).toHaveText('글상자 2');
    await expect(place('"오랫만" 고치기')).toHaveCount(0); // 본문은 위치가 없다

    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('4개를 적용했어요');

    const file = await downloadAs(page);
    expect(file.name).toBe('boxes_수정본.docx');
    const boxes = await readDocxBoxes(file.bytes);
    expect(boxes.choice).toEqual([FIXED.box1, FIXED.box2]);
    expect(boxes.fallback).toEqual([FIXED.box1, FIXED.box2]);
    const texts = (await readDocxBody(file.bytes)).map((p) => p.text);
    expect(texts).toContain(FIXED.body);
    expect(texts).not.toContain(DOCX_BOX_SAMPLE.body);
  });

  test('글상자 안에서 적용한 AI 제안을 되돌리면 파일도 원래대로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithBoxes());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' });

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    const applied = await readDocxBoxes((await downloadAs(page)).bytes);
    expect(applied.choice).toEqual([DOCX_BOX_SAMPLE.box1, FIXED.box2]); // 이 제안만 적용됨

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    const reverted = await readDocxBoxes((await downloadAs(page)).bytes);
    expect(reverted.choice).toEqual([DOCX_BOX_SAMPLE.box1, DOCX_BOX_SAMPLE.box2]);
    expect(reverted.fallback).toEqual([DOCX_BOX_SAMPLE.box1, DOCX_BOX_SAMPLE.box2]);
  });

  test('내 규칙에 "글상자"를 적으면 글상자의 글자 크기도 바뀌고, 되돌리면 처음 크기로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithBoxes('boxes.docx', { boxSize: 16 }));
    await fixByRule(page, '글상자도 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(1); // 글자 크기 한 가지
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('1개를 적용했어요');
    expect((await readDocxBoxes((await downloadAs(page)).bytes)).sizes).toEqual([[12, 12], [12]]);

    await cards.first().getByRole('button', { name: '되돌리기' }).click();
    await expect(cards.first().getByRole('button', { name: '적용' })).toBeVisible();
    expect((await readDocxBoxes((await downloadAs(page)).bytes)).sizes).toEqual([[16, 16], [16]]);
  });

  test('규칙에 글상자를 적지 않으면 글상자는 그대로 둔다(본문만 바뀐다)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithBoxes('boxes.docx', { boxSize: 16 }));
    await fixByRule(page, '본문은 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('적용했어요');
    const file = await downloadAs(page);
    expect((await readDocxBoxes(file.bytes)).sizes).toEqual([[16, 16], [16]]); // 글상자는 그대로
    expect((await readDocxBody(file.bytes)).find((p) => p.text === '휴가 신청서')?.sizes).toEqual([12]); // 본문은 바뀜
  });

  test('서식 점검(문서 안 일관성)은 글상자의 서식을 본문과 비교하지 않는다(글상자는 서식이 본문과 다른 게 보통이다)', async ({ page }) => {
    // 글상자만 24pt 굵게. 글상자까지 본문과 묶어 비교했다면 "글자 크기가 다른 곳"으로 지적했을 것이다.
    await openFile(page, makeDocxWithBoxes('boxes.docx', { boxSize: 24, extraBody: 8 }));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 내역에 올리기' })).toBeDisabled();
  });

  test('옛 방식(VML)으로만 저장된 글상자도 읽고 고친다(글상자 번호가 붙고, 내려받은 파일에도 옛 방식 글상자로 남는다)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithLegacyBox());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: '"되요" 고치기' }).getByTestId('proposal-place')).toHaveText('글상자 1');
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('2개를 적용했어요');
    const file = await downloadAs(page);
    expect((await readDocxBody(file.bytes)).map((p) => p.text)).toContain(FIXED.body);
    const xml = (await readDocxPart(file.bytes, 'word/document.xml')) ?? '';
    expect(xml).toContain('<w:pict>'); // 옛 방식 글상자로 남아 있다(그림 방식으로 바뀌지 않는다)
    expect(xml).not.toContain('mc:AlternateContent');
    expect(await readDocxBoxTexts(file.bytes)).toEqual(FIXED.box2);
  });

  test('머리말 안의 글상자는 AI 에게 넘기지 않고 건드리지 않는다(머리말과 본문의 글만 고친다)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithHeaderBox());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.filter({ hasText: '"몇일" 고치기' }).getByTestId('proposal-place')).toHaveText('머리말');
    await expect(cards.filter({ hasText: '"되요" 고치기' })).toHaveCount(0); // 머리말 안의 글상자는 읽지 않는다
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('2개를 적용했어요');
    const file = await downloadAs(page);
    expect((await readDocxBody(file.bytes, 'word/header1.xml')).map((p) => p.text)).toContain('머리말 며칠 입니다');
    expect(await readDocxBoxTexts(file.bytes, 'word/header1.xml')).toEqual(['머리말 상자 되요', '머리말 상자 되요']); // 글상자 안의 글은 두 벌 모두 그대로
  });

  test('안내문이 글상자를 다룬다고(머리말·꼬리말 안의 글상자는 못 읽는다고) 알려 준다', async ({ page }) => {
    await openFile(page, makeDocxWithBoxes());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    const note = page.getByTestId('coverage-note');
    await expect(note).toContainText('각주·미주, 글상자를 다뤄요');
    await expect(note).toContainText('머리말·꼬리말 안의 글상자와 편집기가 열지 못하는 글상자는 AI가 읽지 못해요');
  });

  for (const word of ['몇일', '할려고']) {
    test(`문서에서 보기: 글상자 1 안의 "${word}" 카드는 그 글을 강조해 보여 주고 문서 영역 안에 보이게 한다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeDocxWithBoxes());
      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      await page.getByTestId('proposal-card').filter({ hasText: `"${word}" 고치기` }).getByRole('button', { name: '문서에서 보기' }).click();
      const view = (await doc(page).boundingBox())!;
      await expect
        .poll(
          async () => {
            const box = await page.locator('.docx-hl-box.focus').first().boundingBox();
            return box !== null && box.y >= view.y && box.y + box.height <= view.y + view.height;
          },
          { timeout: 15_000 },
        )
        .toBe(true);
      await expect(page.locator('.toast').filter({ hasText: '바로 이동하지 못했어요' })).toHaveCount(0);
    });
  }

  // 표 칸 안에 놓인 글상자는 편집기가 글의 자리를 알려 주지 못할 수 있다. 그때는 강조 대신 어디에 있는지 말로 알려 줘야 하고, 아무 반응 없이 넘어가면 안 된다.
  test('문서에서 보기: 표 칸 안에 놓인 글상자(글상자 2)의 글은 강조해 보여 주거나, 강조하지 못하면 글상자 몇 번에 있는지 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithBoxes());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' }).getByRole('button', { name: '문서에서 보기' }).click();
    const view = (await doc(page).boundingBox())!;
    await expect
      .poll(
        async () => {
          // 강조 칸이 아직 없을 때 boundingBox() 가 나타나기를 기다리며 멈추지 않도록, 먼저 개수를 센다.
          const focus = page.locator('.docx-hl-box.focus');
          const box = (await focus.count()) > 0 ? await focus.first().boundingBox({ timeout: 1000 }) : null;
          const shown = box !== null && box.y >= view.y && box.y + box.height <= view.y + view.height;
          const told = (await page.locator('.toast').filter({ hasText: '이 글은 글상자 2에 있어요' }).count()) > 0;
          return shown || told;
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
