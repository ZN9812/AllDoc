// LaTeX 원고의 AI(M3) 종단 시험. 서버는 데모 AI(AI_PROVIDER=mock)와 데모 컴파일러(COMPILER=mock)로 뜬다.
// 데모 컴파일러는 \begin{itemise} 가 있는 줄마다 오류를 내고, 데모 AI 는 그 오류를 itemise → itemize 로 고치자고 제안한다.
import { expect, test, type Page, type Request } from '@playwright/test';
import { loginAs, openFile, textFile } from './helpers';

const SRC = [
  '\\documentclass{article}', // 1
  '\\begin{document}', // 2
  '몇일 뒤에 결과를 정리한다.', // 3
  '', // 4
  '% 몇일 메모', // 5
  '', // 6
  '\\begin{itemise}', // 7
  '\\item 첫째', // 8
  '\\end{itemise}', // 9
  '', // 10
  '\\begin{verbatim}', // 11
  '몇일 그대로', // 12
  '\\end{verbatim}', // 13
  '', // 14
  '끝 문단 몇일.', // 15
  '\\end{document}', // 16
  '',
].join('\n');

const toolbarCompile = (page: Page) => page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true });

/** 컴파일한다(처음이면 나오는 안내는 확인한다). */
async function compile(page: Page): Promise<void> {
  await toolbarCompile(page).click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '확인하고 컴파일' }).click();
}

/** 처음 AI 를 쓸 때 나오는 동의 창에 동의한다. */
async function consent(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '동의하고 계속' }).click();
}

interface SentDoc {
  mode: string;
  compile?: { diagnostics: unknown[]; logExcerpt: string };
  document: { kind: string; paragraphs: Array<{ index: number; text: string; src?: { file: string; line: number; role: string } }> };
}
const body = (r: Request): SentDoc => r.postDataJSON() as SentDoc;
const isPropose = (r: Request) => r.url().endsWith('/api/ai/propose') && r.method() === 'POST';

async function openPaper(page: Page): Promise<void> {
  await loginAs(page);
  await openFile(page, textFile('paper.tex', SRC));
  await expect(page.locator('.cm-content')).toContainText('\\documentclass');
}

test.describe('LaTeX 원고의 AI(데모 AI)', () => {
  test('오류 고치기 → 적용 → 다시 컴파일하면 오류가 사라진다', async ({ page }) => {
    await openPaper(page);
    await compile(page);
    await expect(page.getByTestId('compile-status')).toHaveText('오류 1');

    const sent = page.waitForRequest(isPropose);
    await page.getByRole('button', { name: 'AI로 오류 고치기' }).click();
    await consent(page);
    const req = body(await sent);
    // 오류 고치기는 진단과 로그, 주 파일의 원고를 보낸다. verbatim 블록은 보내지 않는다.
    expect(req.mode).toBe('tex_fix');
    expect(req.compile?.diagnostics).toHaveLength(1);
    expect(req.compile?.logExcerpt).toContain('Environment itemise undefined');
    expect(req.document.kind).toBe('tex');
    expect(req.document.paragraphs.map((p) => p.src?.role)).not.toContain('verbatim');
    expect(req.document.paragraphs.some((p) => p.text.includes('몇일 그대로'))).toBe(false);

    // 변경 내역에 제안이 오르고, 원고에 고칠 곳이 표시된다(\begin·\end 두 곳).
    await expect(page.getByRole('tab', { name: /변경 내역/ })).toHaveAttribute('aria-selected', 'true');
    const card = page.getByTestId('proposal-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('proposal-place')).toHaveText('paper.tex 7행');
    await expect(page.locator('.cm-ai')).toHaveCount(2);
    await expect(page.locator('.cm-line').nth(6).locator('.cm-ai')).toHaveText('{itemise}');
    await expect(page.locator('.cm-line').nth(8).locator('.cm-ai')).toHaveText('{itemise}');
    await page.screenshot({ path: test.info().outputPath('tex-ai-fix.png') });

    // 적용 전에는 원고가 그대로다.
    await expect(page.locator('.cm-content')).toContainText('\\begin{itemise}');
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toHaveAttribute('data-state', 'applied');
    await expect(page.locator('.cm-content')).toContainText('\\begin{itemize}');
    await expect(page.locator('.cm-content')).toContainText('\\end{itemize}');
    await expect(page.locator('.cm-content')).not.toContainText('itemise');
    await expect(page.locator('.cm-ai')).toHaveCount(0);

    await compile(page);
    await expect(page.getByTestId('compile-status')).toHaveText('완료');
    await expect(page.getByTestId('compile-regression')).toHaveCount(0);

    // 되돌리기도 원고에 그대로 반영된다.
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await card.getByRole('button', { name: '되돌리기' }).click();
    await expect(page.locator('.cm-content')).toContainText('\\begin{itemise}');
  });

  test('적용한 뒤 다시 컴파일해 오류가 늘면 알린다', async ({ page }) => {
    await openPaper(page);
    await compile(page);
    await expect(page.getByTestId('compile-status')).toHaveText('오류 1');
    await page.getByRole('button', { name: 'AI로 오류 고치기' }).click();
    await consent(page);
    const card = page.getByTestId('proposal-card');
    await expect(card).toHaveCount(1);

    // 제안을 받은 뒤 다른 블록(15행)에 오류 두 줄을 직접 넣는다. 고칠 블록(7행)은 그대로라 제안은 여전히 적용된다.
    await page.locator('.cm-line').nth(14).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('\\begin{itemise}');
    await page.keyboard.press('Enter');
    await page.keyboard.type('\\begin{itemise}');
    await card.getByRole('button', { name: '적용' }).click();
    await expect(card).toHaveAttribute('data-state', 'applied');

    await compile(page);
    await expect(page.getByTestId('compile-status')).toHaveText('오류 2');
    await expect(page.getByTestId('compile-regression')).toContainText('오류가 1개에서 2개로 늘었어요');
  });

  test('대화: 고른 범위만 보내고, 맞춤법은 본문만 고친다(주석·verbatim 은 그대로)', async ({ page }) => {
    await openPaper(page);
    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await expect(page.getByTestId('coverage-note')).toContainText('verbatim·lstlisting·minted 안의 글은 보내지 않아요');

    // 선택 영역: 15행에 커서를 두고 보내면 그 블록만 간다.
    await page.locator('.cm-line').nth(14).click();
    await page.getByRole('radio', { name: '선택 영역' }).check();
    let sent = page.waitForRequest(isPropose);
    await page.getByRole('button', { name: '맞춤법', exact: true }).click();
    await consent(page);
    let req = body(await sent);
    expect(req.mode).toBe('chat');
    expect(req.document.paragraphs.map((p) => p.src?.line)).toEqual([15]);
    await page.getByRole('button', { name: '변경 내역 보기' }).click();
    const card = page.getByTestId('proposal-card');
    await expect(card).toHaveCount(1);
    await expect(card.getByTestId('proposal-place')).toHaveText('paper.tex 15행');
    await card.getByRole('button', { name: '적용' }).click();
    await expect(page.locator('.cm-content')).toContainText('끝 문단 며칠.');

    // 지금 파일: verbatim 을 뺀 모든 블록을 보낸다. 데모 AI 는 본문 블록의 "몇일" 만 고친다.
    await page.getByRole('tab', { name: /AI 대화/ }).click();
    await page.getByRole('radio', { name: '지금 파일' }).check();
    sent = page.waitForRequest(isPropose);
    await page.getByRole('button', { name: '맞춤법', exact: true }).click();
    req = body(await sent);
    expect(req.document.paragraphs.map((p) => [p.src?.line, p.src?.role])).toEqual([
      [1, 'preamble'],
      [2, 'body'],
      [5, 'comment'],
      [7, 'body'],
      [15, 'body'],
    ]);
    await page.getByRole('tab', { name: /변경 내역/ }).click();
    await page.getByRole('button', { name: '전체 적용' }).click();
    await expect(page.locator('.cm-content')).toContainText('며칠 뒤에 결과를 정리한다.');
    await expect(page.locator('.cm-content')).toContainText('% 몇일 메모');
    await expect(page.locator('.cm-content')).toContainText('몇일 그대로');
    await page.screenshot({ path: test.info().outputPath('tex-ai-chat.png') });
  });
});
