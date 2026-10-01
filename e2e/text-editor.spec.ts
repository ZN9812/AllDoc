import { expect, test } from '@playwright/test';
import { openFile, textFile } from './helpers';

test.describe('글 문서(TXT·MD) 편집', () => {
  test('고치면 자동 저장되고 새로고침해도 남는다', async ({ page }) => {
    await openFile(page, textFile('메모.txt', '첫 줄\n둘째 줄'));
    const area = page.locator('.text-engine textarea');
    await expect(area).toHaveValue('첫 줄\n둘째 줄');
    await area.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' 추가');
    await expect(page.locator('.save-state')).toContainText('저장됨');
    await page.reload();
    await expect(area).toHaveValue('첫 줄\n둘째 줄 추가');
  });

  test('고치지 않고 내려받으면 원래 이름, 고친 뒤에는 _수정본 이름으로 받는다', async ({ page }) => {
    await openFile(page, textFile('보고서.txt', '원본 내용'));
    const [original] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내려받기' }).click()]);
    expect(original.suggestedFilename()).toBe('보고서.txt');

    await page.locator('.text-engine textarea').click();
    await page.keyboard.type('X');
    const [edited] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내려받기' }).click()]);
    expect(edited.suggestedFilename()).toBe('보고서_수정본.txt');
  });

  test('내려받은 파일 내용이 편집한 글과 같다', async ({ page }) => {
    await openFile(page, textFile('a.txt', '가나다'));
    await page.locator('.text-engine textarea').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('라');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '내려받기' }).click()]);
    const path = await dl.path();
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(path, 'utf8')).toBe('가나다라');
  });

  test('마크다운은 편집과 미리보기를 오간다(스크립트는 걸러낸다)', async ({ page }) => {
    await openFile(page, { name: 'doc.md', mimeType: 'text/markdown', buffer: Buffer.from('# 제목\n\n본문 **굵게**\n\n<script>window.__xss=1</script>\n<img src=x onerror="window.__xss=1">', 'utf8') });
    await page.getByRole('button', { name: '미리보기' }).click();
    await expect(page.locator('.md-preview h1')).toHaveText('제목');
    await expect(page.locator('.md-preview strong')).toHaveText('굵게');
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await page.getByRole('button', { name: '편집', exact: true }).click();
    await expect(page.locator('.text-engine textarea')).toBeVisible();
  });

  test('오른쪽 탭: 서식 점검은 글 문서에 해당 없음을 알리고, AI 는 로그인을 안내한다', async ({ page }) => {
    await openFile(page, textFile('메모.txt', '내용'));
    await expect(page.getByRole('tab', { selected: true })).toHaveText(/변경 내역/);
    await expect(page.getByText('아직 제안이 없어요')).toBeVisible();
    await page.getByRole('tab', { name: /서식 점검/ }).click();
    await expect(page.getByText('TXT·MD·PDF는 서식')).toBeVisible();
    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByText('AI 기능은 로그인 후에 쓸 수 있어요')).toBeVisible();
    await expect(page.getByRole('link', { name: '로그인(개발용)' })).toBeVisible();
  });

  test('탭은 화살표 키로도 옮긴다', async ({ page }) => {
    await openFile(page, textFile('메모.txt', '내용'));
    await page.getByRole('tab', { name: /AI 대화/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /서식 점검/ })).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: /AI 대화/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('긴 글은 종이가 글 길이만큼 늘어나고, AI 표시를 그리는 층도 같은 높이다', async ({ page }) => {
    await openFile(page, textFile('긴글.txt', Array.from({ length: 200 }, (_, i) => `${i + 1}번째 줄입니다.`).join('\n')));
    const area = (await page.locator('.text-engine textarea').boundingBox())!;
    expect(area.height).toBeGreaterThan(3000);
    const paper = (await page.locator('.text-engine').boundingBox())!;
    expect(paper.height).toBeGreaterThanOrEqual(area.height - 1);
    const layer = (await page.locator('.text-engine .layer').boundingBox())!;
    expect(layer.height).toBeGreaterThanOrEqual(area.height - 1);
  });
});
