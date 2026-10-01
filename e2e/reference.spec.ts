import { expect, test, type Page } from '@playwright/test';
import { makeDocx, readDocx, type ParaSpec } from './docx-fixtures';
import { downloadAs, openFile, type Upload } from './helpers';
import { makeHwp, readHwp } from './hwp-fixtures';

/** 기준 문서(양식): 제목 18pt 굵게 가운데, 번호 항목 12pt, 본문은 바탕 11pt·줄 간격 150%·왼쪽 */
const FORM: ParaSpec[] = [
  { text: '양식 제목', font: '맑은 고딕', sizePt: 18, bold: true, align: 'center' },
  { text: '1. 항목 하나', font: '맑은 고딕', sizePt: 12 },
  { text: '2. 항목 둘', font: '맑은 고딕', sizePt: 12 },
  { text: '3. 항목 셋', font: '맑은 고딕', sizePt: 12 },
  { text: '본문은 이렇게 씁니다.', font: '바탕', sizePt: 11, linePct: 150, align: 'left' },
];

async function useReference(page: Page, file: Upload): Promise<void> {
  await page.getByRole('tab', { name: /서식 점검/ }).click();
  await page.getByRole('radio', { name: /기준 문서/ }).check();
  await page.getByTestId('reference-input').setInputFiles(file);
  await expect(page.locator('.extra')).toContainText(file.name, { timeout: 30_000 });
}

test.describe('기준 문서(양식)에 맞추기', () => {
  test('DOCX 양식 → DOCX 문서: 양식의 글꼴·크기·정렬·줄 간격에 맞추는 제안이 올라오고, 적용하면 파일에 반영된다', async ({ page }) => {
    await openFile(page, makeDocx());
    await useReference(page, makeDocx('양식.docx', FORM));
    await page.getByRole('button', { name: '기준에 맞추기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(5);
    await expect(cards.filter({ hasText: '번호 항목(1.) 글자 크기를 기준 문서에 맞춤' })).toContainText('12pt');

    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('5개를 적용했어요');

    const paras = await readDocx((await downloadAs(page)).bytes);
    expect(paras.map((p) => p.sizes[0])).toEqual([18, 12, 12, 12, 11]);
    expect(paras.at(-1)).toMatchObject({ fonts: ['바탕'], align: 'left', linePct: 150 });
    expect(paras[0]).toMatchObject({ bold: true, align: 'center' }); // 제목은 이미 양식과 같다
  });

  test('HWP 양식 → DOCX 문서: 다른 형식의 양식도 읽어서 맞춘다', async ({ page }) => {
    await openFile(page, makeDocx());
    await useReference(page, makeHwp('hwp', '양식.hwp'));
    await page.getByRole('button', { name: '기준에 맞추기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards.first()).toBeVisible();
    // 양식(HWP)의 번호 항목은 10pt 가 대표다 → 셋째 항목(13pt)만 10pt 로 맞추는 제안이 있다.
    const size = cards.filter({ hasText: '번호 항목(1.) 글자 크기를 기준 문서에 맞춤' });
    await expect(size).toContainText('13pt');
    await expect(size).toContainText('10pt');
  });

  test('DOCX 양식 → HWP 문서: 한글 문서를 Word 양식에 맞춘다', async ({ page }) => {
    await openFile(page, makeHwp('hwp'));
    await useReference(page, makeDocx('양식.docx', FORM));
    await page.getByRole('button', { name: '기준에 맞추기' }).click();
    const size = page.getByTestId('proposal-card').filter({ hasText: '번호 항목(1.) 글자 크기를 기준 문서에 맞춤' });
    await expect(size).toContainText('12pt');
    await size.getByRole('button', { name: '적용' }).click();
    await expect(size).toContainText('적용됨');
    const file = await downloadAs(page, /^HWP로 내려받기/);
    expect(readHwp(file.bytes).map((p) => p.sizePt)).toEqual([18, 12, 12, 12, 10]);
  });

  test('서식을 읽을 수 없는 파일은 이유를 알려 준다', async ({ page }) => {
    await openFile(page, makeDocx());
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await page.getByRole('radio', { name: /기준 문서/ }).check();
    await page.getByTestId('reference-input').setInputFiles({ name: '깨짐.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('이건 Word 파일이 아니에요') });
    await expect(page.locator('.toast').last()).toContainText('Word(DOCX) 문서가 아니거나 깨져 있어요');
    await expect(page.getByRole('button', { name: '기준에 맞추기' })).toBeDisabled();
  });
});
