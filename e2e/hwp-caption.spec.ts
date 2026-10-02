import { expect, test } from '@playwright/test';
import { askAi, downloadAs, fixByRule, loginAs, openFile } from './helpers';
import { CAPTION_SAMPLE, makeHwpWithCaptions, readHwp, readHwpCaptions } from './hwp-fixtures';

// 한글 문서의 그림·표 캡션. 시험 문서는 본문 둘째 문단에 글 캡션이 달린 그림, 셋째 문단에 글 캡션이 달린 표, 본문 문단으로 이루어진다.
// 오탈자가 그림 캡션("할려고")·표 캡션("되요")·본문("몇일")에 하나씩 있어서 데모 AI 가 3가지를 제안한다.
// 캡션 글은 코어에서 "라벨 + 공백 + 번호 자리 + 공백 + 글"로 읽힌다(번호는 문서가 매기는 자동 번호라 글에는 공백 한 글자로만 나온다).

const NATIVE = { hwp: /^HWP로 내려받기/, hwpx: /^HWPX로 내려받기/ } as const;
const FIXED = CAPTION_SAMPLE.fixed;
/** 표 캡션은 코어가 만든 문서를 다시 열면 글 끝에 공백이 하나 붙는다(코어의 동작). 글만 견주려고 끝 공백을 뺀다. */
const captionTexts = (bytes: Buffer | Uint8Array): string[] => readHwpCaptions(bytes).map((c) => c.text.trimEnd());
const FIXED_CAPTIONS = [`그림   ${FIXED.pictureText}`, `표   ${FIXED.tableText}`];
const ORIGINAL_CAPTIONS = [`그림   ${CAPTION_SAMPLE.pictureText}`, `표   ${CAPTION_SAMPLE.tableText}`];

test.describe('한글 문서의 그림·표 캡션', () => {
  for (const format of ['hwp', 'hwpx'] as const) {
    test(`${format.toUpperCase()}: AI 가 캡션 글도 맞춤법을 제안하고, 카드에 캡션 위치가 보이고, 전체 적용하면 파일의 캡션에 반영된다(번호 자리는 그대로)`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeHwpWithCaptions(format));

      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      const cards = page.getByTestId('proposal-card');
      await expect(cards).toHaveCount(3);
      const place = (title: string) => cards.filter({ hasText: title }).getByTestId('proposal-place');
      await expect(place('"할려고" 고치기')).toHaveText('그림 캡션 1');
      await expect(place('"되요" 고치기')).toHaveText('표 1 캡션');
      await expect(place('"몇일" 고치기')).toHaveCount(0); // 본문은 위치가 없다

      await page.getByRole('button', { name: '전체 적용' }).click();
      await expect(page.locator('.toast').last()).toContainText('3개를 적용했어요');

      const file = await downloadAs(page, NATIVE[format]);
      expect(file.name).toBe(`captions_수정본.${format}`);
      expect(captionTexts(file.bytes)).toEqual(FIXED_CAPTIONS);
      expect(readHwp(file.bytes).map((p) => p.text)).toContain(FIXED.body);
    });
  }

  test('캡션에서 적용한 AI 제안을 되돌리면 파일도 원래대로 돌아간다(표 캡션)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithCaptions('hwp'));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"되요" 고치기' });

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    expect(captionTexts((await downloadAs(page, NATIVE.hwp)).bytes)).toEqual([ORIGINAL_CAPTIONS[0], FIXED_CAPTIONS[1]]); // 이 제안만 적용됨

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect(captionTexts((await downloadAs(page, NATIVE.hwp)).bytes)).toEqual(ORIGINAL_CAPTIONS);
  });

  test('내 규칙에 "캡션"을 적으면 캡션의 글자 크기도 바뀌고, 되돌리면 처음 크기로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithCaptions('hwp', 'captions.hwp', { captionSize: 16 }));
    await fixByRule(page, '캡션도 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(1); // 글자 크기 한 가지
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('1개를 적용했어요');
    expect(readHwpCaptions((await downloadAs(page, NATIVE.hwp)).bytes).map((c) => c.sizePt)).toEqual([12, 12]);

    await cards.first().getByRole('button', { name: '되돌리기' }).click();
    await expect(cards.first().getByRole('button', { name: '적용' })).toBeVisible();
    expect(readHwpCaptions((await downloadAs(page, NATIVE.hwp)).bytes).map((c) => c.sizePt)).toEqual([16, 16]);
  });

  test('규칙에 캡션을 적지 않으면 캡션은 그대로 둔다(본문만 바뀐다)', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeHwpWithCaptions('hwp', 'captions.hwp', { captionSize: 16 }));
    await fixByRule(page, '본문은 12pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('적용했어요');
    const file = await downloadAs(page, NATIVE.hwp);
    expect(readHwpCaptions(file.bytes).map((c) => c.sizePt)).toEqual([16, 16]); // 캡션은 그대로
    expect(readHwp(file.bytes).find((p) => p.text === '실적 보고서')?.sizePt).toBe(12); // 본문은 바뀜
  });

  test('서식 점검(문서 안 일관성)은 캡션의 서식을 본문과 비교하지 않는다', async ({ page }) => {
    // 캡션만 24pt 굵게. 캡션까지 본문과 묶어 비교했다면 "글자 크기가 다른 곳"으로 지적했을 것이다.
    await openFile(page, makeHwpWithCaptions('hwp', 'captions.hwp', { captionSize: 24, extraBody: 8 }));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 내역에 올리기' })).toBeDisabled();
    await expect(page.getByTestId('coverage-note')).toContainText('그림·표 캡션을 다뤄요');
  });

  // "문서에서 보기": 편집기가 캡션 안으로 이동한다. 다만 코어는 캡션의 자동 번호를 글 속에 글자로 끼워 그려서, 편집기의 글자 위치가 번호 뒤에서
  // 번호의 글자 수만큼 어긋난다(실제 편집기에서 번호 뒤의 글을 선택해 보면 한 글자 앞으로 밀려서 엉뚱한 글이 선택된다).
  // 그래서 번호 뒤의 글은 선택하지 않고 번호 앞에 캐럿만 두며, 그렇다고 알린다. 엉뚱한 글이 선택돼 보이는 것보다 낫다.
  for (const [word, place, where] of [
    ['되요', '표 1 캡션', '표 캡션'],
    ['할려고', '그림 캡션 1', '그림 캡션'],
  ] as const) {
    test(`문서에서 보기: ${where}(${place}) 안의 "${word}" 카드는 편집기가 그 캡션으로 이동하되, 번호 뒤의 글이라 선택하지 않고 번호 앞에 커서를 두었다고 알려 준다`, async ({ page }) => {
      await loginAs(page);
      await openFile(page, makeHwpWithCaptions('hwp'));
      await askAi(page, '맞춤법');
      await page.getByRole('button', { name: '변경 내역 보기' }).click();
      const card = page.getByTestId('proposal-card').filter({ hasText: `"${word}" 고치기` });
      await expect(card.getByTestId('proposal-place')).toHaveText(place);
      await card.getByRole('button', { name: '문서에서 보기' }).click();
      await expect(page.locator('.toast').filter({ hasText: '번호 앞에 커서를 두었어요' })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.toast').filter({ hasText: '이동하지 못했어요' })).toHaveCount(0);
      const frame = page.frames().find((f) => f.url().includes('rhwp-studio'));
      if (!frame) throw new Error('한글 편집기 화면을 찾지 못했어요');
      expect(await frame.locator('.selection-highlight').count()).toBe(0); // 엉뚱한 글을 선택해 보이지 않는다
    });
  }
});
