import { expect, test, type Page } from '@playwright/test';
import { DOCX_AREA_SAMPLE, makeDocxWithAreas, readDocx, readDocxAreas } from './docx-fixtures';
import { askAi, downloadAs, fixByRule, loginAs, openFile } from './helpers';

// Word 문서의 머리말·꼬리말·각주·미주. 시험 문서는 본문 두 줄, 머리말, 꼬리말(쪽 번호 필드 포함), 둘째 줄에 단 각주로 이루어진다.
// 오탈자가 머리말("오랫만"), 본문("몇일"), 각주("되요"), 꼬리말("할려고")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.

const FIXED = DOCX_AREA_SAMPLE.fixed;
const doc = (page: Page) => page.locator('.docx-engine');

// Word(DOCX) 지원을 끄고 빌드한 경우(VITE_DISABLE_DOCX=1)에는 이 시험을 건너뛴다.
test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 지원을 끄고 빌드함');

test.describe('Word 문서의 머리말·꼬리말·각주', () => {
  test('AI 가 머리말·꼬리말·각주 안의 글도 맞춤법을 제안하고, 카드에 위치가 보이고, 전체 적용하면 파일에 반영된다(쪽 번호 필드와 각주는 그대로)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithAreas());

    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(4);
    const place = (title: string) => cards.filter({ hasText: title }).getByTestId('proposal-place');
    await expect(place('"오랫만" 고치기')).toHaveText('머리말');
    await expect(place('"되요" 고치기')).toHaveText('각주 1');
    await expect(place('"할려고" 고치기')).toHaveText('꼬리말');
    await expect(place('"몇일" 고치기')).toHaveCount(0); // 본문은 위치가 없다

    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('4개를 적용했어요');

    const file = await downloadAs(page);
    expect(file.name).toBe('areas_수정본.docx');
    const areas = await readDocxAreas(file.bytes);
    expect(areas.headers).toEqual([FIXED.header]);
    // 꼬리말의 글은 고쳐지고, 쪽 번호 필드(PAGE)는 그대로 남는다. 필드의 결과("1")도 글로 읽힌다.
    expect(areas.footers).toEqual([`${FIXED.footer}1`]);
    expect(areas.footerXml).toContain('PAGE');
    expect(areas.footnotes).toEqual([FIXED.note]);
    expect(areas.bodyXml).toContain('footnoteReference'); // 각주 표시가 지워지지 않았다
    expect((await readDocx(file.bytes)).map((p) => p.text).filter((t) => t !== '')).toEqual(FIXED.body);
  });

  test('각주 안에서 적용한 AI 제안을 되돌리면 파일도 원래대로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithAreas());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' });

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    const applied = await readDocxAreas((await downloadAs(page)).bytes);
    expect(applied.footnotes).toEqual([FIXED.note]); // 이 제안만 적용됨
    expect(applied.headers).toEqual([DOCX_AREA_SAMPLE.header]);
    expect(applied.footers).toEqual([`${DOCX_AREA_SAMPLE.footer}1`]);

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    const reverted = await readDocxAreas((await downloadAs(page)).bytes);
    expect(reverted.footnotes).toEqual([DOCX_AREA_SAMPLE.note]);
  });

  test('미주 안의 글도 고치고 되돌린다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithAreas('endnote.docx', { endnote: true }));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' });
    await expect(card.getByTestId('proposal-place')).toHaveText('미주 1');
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    expect((await readDocxAreas((await downloadAs(page)).bytes)).endnotes).toEqual([FIXED.note]);
    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect((await readDocxAreas((await downloadAs(page)).bytes)).endnotes).toEqual([DOCX_AREA_SAMPLE.note]);
  });

  test('서식 점검(문서 안 일관성)은 머리말의 서식을 본문과 비교하지 않는다(머리말은 서식이 본문과 다른 게 보통이다)', async ({ page }) => {
    // 머리말만 16pt 굵게. 머리말까지 본문과 묶어 비교했다면 "글자 크기가 다른 곳"으로 지적했을 것이다.
    await openFile(page, makeDocxWithAreas('areas.docx', { headerSize: 16, extraBody: 8 }));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 내역에 올리기' })).toBeDisabled();
    await expect(page.getByTestId('coverage-note')).toContainText('표·머리말·꼬리말·각주 안의 글은 AI 대화로 고쳐요');
  });

  test('내 규칙에 "머리말"을 적으면 머리말의 글자 크기도 바뀌고, 되돌리면 처음 크기로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithAreas('areas.docx', { headerSize: 16 }));
    await fixByRule(page, '머리말도 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(1); // 글자 크기 한 가지
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('1개를 적용했어요');
    expect((await readDocxAreas((await downloadAs(page)).bytes)).headerSizes).toEqual([12]);

    await cards.first().getByRole('button', { name: '되돌리기' }).click();
    await expect(cards.first().getByRole('button', { name: '적용' })).toBeVisible();
    expect((await readDocxAreas((await downloadAs(page)).bytes)).headerSizes).toEqual([16]);
  });

  test('규칙에 머리말을 적지 않으면 머리말은 그대로 둔다(본문만 바뀐다)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithAreas('areas.docx', { headerSize: 16 }));
    await fixByRule(page, '본문은 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('적용했어요');
    const file = await downloadAs(page);
    expect((await readDocxAreas(file.bytes)).headerSizes).toEqual([16]); // 머리말은 그대로
    expect((await readDocx(file.bytes)).filter((p) => p.text !== '').map((p) => p.sizes[0])).toEqual([12, 12]); // 본문은 바뀜
  });

  for (const [word, where] of [
    ['오랫만', '머리말'],
    ['할려고', '꼬리말'],
    ['되요', '각주 1'],
  ] as const) {
    test(`문서에서 보기: ${where} 안의 "${word}" 카드는 그 글을 강조해 보여 주고 문서 영역 안으로 이동한다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeDocxWithAreas());
      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      await page.getByTestId('proposal-card').filter({ hasText: `"${word}" 고치기` }).getByRole('button', { name: '문서에서 보기' }).click();
      // 부드럽게 스크롤하므로 멈출 때까지 기다린 뒤, 강조한 글이 문서 영역 안에 들어와 있는지 본다(꼬리말·각주는 쪽 아래에 있어 이동해야 보인다).
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

  test('문서에서 보기: Word 편집기가 쪽에 그리지 않는 미주는 이동하지 못했다고 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocxWithAreas('endnote.docx', { endnote: true }));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' }).getByRole('button', { name: '문서에서 보기' }).click();
    await expect(page.locator('.toast').filter({ hasText: '이 글은 미주 1에 있어요' })).toBeVisible({ timeout: 15_000 });
  });

  test('안내문이 머리말·꼬리말·각주·미주를 다룬다고 알려 준다', async ({ page }) => {
    await openFile(page, makeDocxWithAreas());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByTestId('coverage-note')).toContainText('머리말·꼬리말, 각주·미주를 다뤄요');
  });
});
