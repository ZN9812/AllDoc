import { expect, test } from '@playwright/test';
import { askAi, downloadAs, fixByRule, loginAs, openFile } from './helpers';
import { BOX_SAMPLE, makeHwpWithBoxes, makeHwpWithNestedBoxes, readHwp, readHwpBoxes } from './hwp-fixtures';

// 한글 문서의 글상자. 시험 문서는 글상자 1(문단 둘, 본문 첫 문단에 놓임), 표(둘째 문단) 오른쪽 칸 안의 글상자 2, 본문 문단으로 이루어진다.
// 오탈자가 글상자 1 의 첫 문단("오랫만")·둘째 문단("할려고"), 글상자 2("되요"), 본문("몇일")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.

const NATIVE = { hwp: /^HWP로 내려받기/, hwpx: /^HWPX로 내려받기/ } as const;
const FIXED = BOX_SAMPLE.fixed;
const FIXED_BOXES = [...FIXED.box1, FIXED.box2];

test.describe('한글 문서의 글상자', () => {
  for (const format of ['hwp', 'hwpx'] as const) {
    test(`${format.toUpperCase()}: AI 가 글상자 안의 글도 맞춤법을 제안하고, 카드에 글상자 위치가 보이고, 전체 적용하면 파일의 글상자에 반영된다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, await makeHwpWithBoxes(format));

      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      const cards = page.getByTestId('proposal-card');
      await expect(cards).toHaveCount(4);
      const place = (title: string) => cards.filter({ hasText: title }).getByTestId('proposal-place');
      await expect(place('"오랫만" 고치기')).toHaveText('글상자 1');
      await expect(place('"할려고" 고치기')).toHaveText('글상자 1');
      await expect(place('"되요" 고치기')).toHaveText('글상자 2');
      await expect(place('"몇일" 고치기')).toHaveCount(0); // 본문은 위치가 없다

      await page.getByRole('button', { name: '전체 적용' }).click();
      await expect(page.locator('.toast').last()).toContainText('4개를 적용했어요');

      const file = await downloadAs(page, NATIVE[format]);
      expect(file.name).toBe(`boxes_수정본.${format}`);
      expect(readHwpBoxes(file.bytes).map((b) => b.text)).toEqual(FIXED_BOXES);
      expect(readHwp(file.bytes).map((p) => p.text)).toContain(FIXED.body);
    });
  }

  test('글상자 안에서 적용한 AI 제안을 되돌리면 파일도 원래대로 돌아간다(표 칸 안의 글상자 포함)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, await makeHwpWithBoxes('hwp'));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' });

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    const applied = readHwpBoxes((await downloadAs(page, NATIVE.hwp)).bytes).map((b) => b.text);
    expect(applied).toEqual([...BOX_SAMPLE.box1, FIXED.box2]); // 이 제안만 적용됨

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect(readHwpBoxes((await downloadAs(page, NATIVE.hwp)).bytes).map((b) => b.text)).toEqual([...BOX_SAMPLE.box1, BOX_SAMPLE.box2]);
  });

  test('내 규칙에 "글상자"를 적으면 글상자의 글자 크기도 바뀌고(표 칸 안의 글상자까지), 되돌리면 처음 크기로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, await makeHwpWithBoxes('hwp', 'boxes.hwp', { boxSize: 16 }));
    await fixByRule(page, '글상자도 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(1); // 글자 크기 한 가지
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('1개를 적용했어요');
    expect(readHwpBoxes((await downloadAs(page, NATIVE.hwp)).bytes).map((b) => b.sizePt)).toEqual([12, 12, 12]);

    await cards.first().getByRole('button', { name: '되돌리기' }).click();
    await expect(cards.first().getByRole('button', { name: '적용' })).toBeVisible();
    expect(readHwpBoxes((await downloadAs(page, NATIVE.hwp)).bytes).map((b) => b.sizePt)).toEqual([16, 16, 16]);
  });

  test('규칙에 글상자를 적지 않으면 글상자는 그대로 둔다(본문만 바뀐다)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, await makeHwpWithBoxes('hwp', 'boxes.hwp', { boxSize: 16 }));
    await fixByRule(page, '본문은 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('적용했어요');
    const file = await downloadAs(page, NATIVE.hwp);
    expect(readHwpBoxes(file.bytes).map((b) => b.sizePt)).toEqual([16, 16, 16]); // 글상자는 그대로
    expect(readHwp(file.bytes).find((p) => p.text === '휴가 신청서')?.sizePt).toBe(12); // 본문은 바뀜
  });

  test('서식 점검(문서 안 일관성)은 글상자의 서식을 본문과 비교하지 않는다(글상자는 서식이 본문과 다른 게 보통이다)', async ({ page }) => {
    // 글상자만 24pt 굵게. 글상자까지 본문과 묶어 비교했다면 "글자 크기가 다른 곳"으로 지적했을 것이다.
    await openFile(page, await makeHwpWithBoxes('hwp', 'boxes.hwp', { boxSize: 24, extraBody: 8 }));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 내역에 올리기' })).toBeDisabled();
    await expect(page.getByTestId('coverage-note')).toContainText('글상자를 다뤄요');
  });

  // "문서에서 보기": 본문에 놓인 글상자, 글상자 안의 글상자, 글상자 안 표의 칸은 편집기가 그 글로 이동해 선택 표시를 보여 준다.
  // 표 칸 안에 놓인 글상자는 편집기가 캐럿 자리를 구하지 못해서(실제 편집기에서 확인했다) 이동하지 못하고, 그때는 어느 글상자인지 알려야 한다.
  // 편집기가 나중에 그것도 이동하게 되면 알림 없이 선택 표시가 보여도 된다.
  const REVEAL: Array<[string, string, string]> = [
    ['몇일', '글상자 1', '본문에 놓인 글상자'],
    ['할려고', '글상자 2', '글상자 안의 글상자'],
    ['오랫만', '글상자 1', '글상자 안 표의 칸'],
  ];
  for (const [word, place, where] of REVEAL) {
    test(`문서에서 보기: ${where}(${place}) 안의 "${word}" 카드는 편집기가 그 글로 이동해 선택 표시를 보여 준다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeHwpWithNestedBoxes());
      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      const card = page.getByTestId('proposal-card').filter({ hasText: `"${word}" 고치기` });
      await expect(card.getByTestId('proposal-place')).toHaveText(place);
      await card.getByRole('button', { name: '문서에서 보기' }).click();
      const frame = page.frames().find((f) => f.url().includes('rhwp-studio'));
      if (!frame) throw new Error('한글 편집기 화면을 찾지 못했어요');
      await expect.poll(async () => (await frame.locator('.selection-highlight').count()) > 0, { timeout: 15_000 }).toBe(true);
      await expect(page.locator('.toast').filter({ hasText: '이동하지 못했어요' })).toHaveCount(0);
    });
  }

  test('문서에서 보기: 표 칸 안에 놓인 글상자(글상자 3)의 글은 편집기가 그 글로 이동해 보여 주거나, 이동하지 못하면 글상자 몇 번에 있는지 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithNestedBoxes());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' });
    await expect(card.getByTestId('proposal-place')).toHaveText('글상자 3');
    await card.getByRole('button', { name: '문서에서 보기' }).click();
    const frame = page.frames().find((f) => f.url().includes('rhwp-studio'));
    if (!frame) throw new Error('한글 편집기 화면을 찾지 못했어요');
    await expect
      .poll(async () => (await frame.locator('.selection-highlight').count()) > 0 || (await page.locator('.toast').filter({ hasText: '이 글은 글상자 3에 있어요' }).count()) > 0, { timeout: 15_000 })
      .toBe(true);
  });

  test('글상자 안에 놓인 글상자와 표 칸 안·글상자 안 표 칸의 글도 AI 제안을 적용하고 되돌린다(파일에서 확인)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithNestedBoxes());
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    await expect(page.getByTestId('proposal-card')).toHaveCount(4);
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('4개를 적용했어요');
    const edited = readHwpBoxes((await downloadAs(page, NATIVE.hwp)).bytes).map((b) => b.text);
    expect(edited).toEqual(expect.arrayContaining(['바깥 글상자 며칠 입니다', '안쪽 글상자 하려고 합니다', '글상자 안 표 오랜만 입니다', '표 칸 안 글상자 돼요 라고 적습니다']));
    expect(edited.join('\n')).not.toMatch(/몇일|할려고|오랫만|되요/);

    for (const word of ['몇일', '할려고', '오랫만', '되요']) {
      const card = page.getByTestId('proposal-card').filter({ hasText: `"${word}" 고치기` });
      await card.getByRole('button', { name: '되돌리기' }).click();
      await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    }
    const back = readHwpBoxes((await downloadAs(page, NATIVE.hwp)).bytes).map((b) => b.text);
    expect(back).toEqual(expect.arrayContaining(['바깥 글상자 몇일 입니다', '안쪽 글상자 할려고 합니다', '글상자 안 표 오랫만 입니다', '표 칸 안 글상자 되요 라고 적습니다']));
  });
});
