import { expect, test, type Page } from '@playwright/test';
import { askAi, downloadAs, fixByRule, loginAs, openFile } from './helpers';
import { makeDocx, readDocx, type ParaSpec, type TableSpec } from './docx-fixtures';

// Word(DOCX) 문서의 표 안의 글. 한글(HWP) 쪽 시험은 hwp-table.spec.ts.
test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 지원을 끄고 빌드함');

const BODY = { font: '맑은 고딕', sizePt: 10, linePct: 160, align: 'both' } as const;
const body = (text: string): ParaSpec => ({ text, ...BODY });
const head = (text: string): ParaSpec => ({ ...body(text), sizePt: 14, bold: true });

/** 제목, 본문 8개, 표(2x2: 왼쪽 칸만 14pt 굵게). 양식에서는 제목 칸의 서식이 값 칸과 다른 게 보통이다. */
const FORM: Array<ParaSpec | TableSpec> = [
  { text: '신청서', font: '맑은 고딕', sizePt: 18, bold: true, align: 'center' },
  ...Array.from({ length: 8 }, (_, i) => body(`본문 ${i + 1}번째 문장입니다.`)),
  [
    [head('성명'), body('홍길동')],
    [head('소속'), body('개발팀')],
  ],
];

// 한글 쪽 시험 문서(TABLE_SAMPLE)와 같은 모양: 제목, 2x2 표, "홍길동" 칸 안의 작은 표, 맺음 문단.
// 오탈자가 바깥 표 칸("몇일", "할려고"), 안쪽 표 칸("오랫만"), 본문("되요")에 하나씩 있어서 데모 AI 가 4가지를 제안한다.
const TABLE_DOC: Array<ParaSpec | TableSpec> = [
  body('휴가 신청서'),
  [
    ['성명', { children: [{ text: '홍길동' }, [['동행', '오랫만에 가요']]] }],
    ['신청 사유', '몇일 동안 휴가를 할려고 합니다'],
  ],
  body('감사합니다. 잘 되요.'),
];
const FIXED = ['휴가 신청서', '성명', '홍길동', '동행', '오랜만에 가요', '신청 사유', '며칠 동안 휴가를 하려고 합니다', '감사합니다. 잘 돼요.'];
const ORIGINAL = ['휴가 신청서', '성명', '홍길동', '동행', '오랫만에 가요', '신청 사유', '몇일 동안 휴가를 할려고 합니다', '감사합니다. 잘 되요.'];

/** 내려받은 DOCX 의 글(빈 문단은 뺀다) */
const texts = async (page: Page): Promise<string[]> =>
  (await readDocx((await downloadAs(page)).bytes)).map((p) => p.text).filter((t) => t !== '');

test.describe('Word(DOCX) 문서의 표 안의 글', () => {
  test('서식 점검(문서 안 일관성)은 표 안의 글을 본문과 비교하지 않는다(칸마다 서식이 다른 건 양식에서 흔하다)', async ({ page }) => {
    await openFile(page, makeDocx('양식.docx', FORM));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('같은 역할의 문단끼리 서식이 다른 곳을 찾지 못했어요.')).toBeVisible();
    await expect(page.getByRole('button', { name: '변경 내역에 올리기' })).toBeDisabled();
    await expect(page.getByTestId('coverage-note')).toContainText('표 밖 본문만 비교하고');
  });

  test('표 밖 본문의 서식 차이는 표가 있어도 그대로 찾는다', async ({ page }) => {
    // 표 칸은 빼고, 본문 8개 중 하나만 13pt 로 한다.
    const items = FORM.map((it, i) => (i === 3 && !Array.isArray(it) ? { ...it, sizePt: 13 } : it));
    await openFile(page, makeDocx('양식.docx', items));
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.locator('.res li').first()).toContainText('본문 글자 크기가 다른 곳 1곳');
  });

  test('AI 가 표 안의 글(표 안의 표 포함)도 맞춤법을 제안하고, 카드에 표 위치가 보이고, 전체 적용하면 파일에 반영된다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx('휴가.docx', TABLE_DOC));

    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const cards = page.getByTestId('proposal-card');
    await expect(cards).toHaveCount(4);
    const place = (title: string) => cards.filter({ hasText: title }).getByTestId('proposal-place');
    await expect(place('"몇일" 고치기')).toHaveText('표 1 · 2행 2열');
    await expect(place('"할려고" 고치기')).toHaveText('표 1 · 2행 2열');
    await expect(place('"오랫만" 고치기')).toHaveText('표 2 · 1행 2열 (표 안의 표)');
    await expect(place('"되요" 고치기')).toHaveCount(0); // 본문은 표 위치가 없다

    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('4개를 적용했어요');
    expect(await texts(page)).toEqual(FIXED);
  });

  test('표 안에서 적용한 AI 제안을 되돌리면 파일도 원래대로 돌아간다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, makeDocx('휴가.docx', TABLE_DOC));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"오랫만" 고치기' });

    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toContainText('적용됨');
    expect(await texts(page)).toEqual(ORIGINAL.map((t) => (t === '오랫만에 가요' ? '오랜만에 가요' : t))); // 이 제안만 적용됨

    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(card.getByRole('button', { name: '적용' })).toBeVisible();
    expect(await texts(page)).toEqual(ORIGINAL);
  });

  test('내 규칙으로 표 밖의 서식만 고치고, 표 칸의 서식은 그대로 둔다', async ({ page }) => {
    // 데모 AI 의 "내 규칙"은 표 밖 문단에만 서식 규칙을 적용한다(실제 AI 에게는 같은 내용을 안내 문구로 준다).
    await loginAs(page);
    const items = FORM.map((it, i) => (i === 3 && !Array.isArray(it) ? { ...it, sizePt: 13 } : it));
    await openFile(page, makeDocx('양식.docx', items));
    await fixByRule(page, '본문은 맑은 고딕 10pt');
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.toast').last()).toContainText('1개를 적용했어요');

    const paras = await readDocx((await downloadAs(page)).bytes);
    const by = (t: string) => paras.find((p) => p.text === t);
    expect(by('본문 4번째 문장입니다.')?.sizes).toEqual([10]); // 표 밖의 13pt 는 10pt 로
    expect(by('성명')?.sizes).toEqual([14]); // 표 칸의 14pt 는 그대로
    expect(by('소속')?.sizes).toEqual([14]);
  });

  test('칸을 합친 표(가로·세로)에서도 칸의 위치를 바르게 알려 준다', async ({ page }) => {
    await loginAs(page);
    await openFile(
      page,
      makeDocx('합친표.docx', [
        [
          [{ children: [{ text: '제목 칸' }], colSpan: 2 }, '몇일 뒤 구분'], // 가로로 합친 칸 다음 칸은 3열
          ['항목', '내용', { children: [{ text: '오랫만에 만남' }], vMerge: 'restart' }], // 세로로 합친 칸
          ['기간', '비고', { children: [], vMerge: 'continue' }],
        ],
      ]),
    );
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const place = (title: string) => page.getByTestId('proposal-card').filter({ hasText: title }).getByTestId('proposal-place');
    await expect(place('"몇일" 고치기')).toHaveText('표 1 · 1행 3열');
    await expect(place('"오랫만" 고치기')).toHaveText('표 1 · 2행 3열');
  });

  test('"문서에서 보기"를 누르면 긴 문서의 표 칸 안의 글로 스크롤한다', async ({ page }) => {
    await loginAs(page);
    const lead: ParaSpec[] = Array.from({ length: 150 }, (_, i) => ({ text: `${i + 1}번째 문단입니다. 특별한 내용이 없는 줄이에요.`, font: '맑은 고딕', sizePt: 10 }));
    await openFile(page, makeDocx('긴표.docx', [...lead, [['항목', '내용'], ['기간', '몇일 뒤에 만나요']]]));
    await askAi(page, '맞춤법');
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card').filter({ hasText: '"몇일" 고치기' });
    await expect(card.getByTestId('proposal-place')).toHaveText('표 1 · 2행 2열');
    const engine = page.locator('.docx-engine');
    expect(await engine.evaluate((el) => el.scrollTop)).toBe(0);

    await card.getByRole('button', { name: '문서에서 보기' }).click();
    await expect(page.locator('.docx-engine .superdoc-line', { hasText: '몇일 뒤에 만나요' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => engine.evaluate((el) => el.scrollTop), { timeout: 15_000 }).toBeGreaterThan(1000);
  });
});
