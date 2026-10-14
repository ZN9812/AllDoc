// 진짜 컴파일 일꾼(TeX Live)으로 도는 LaTeX 종단 시험. REQUIRE_TEXLIVE=1 일 때만 돈다(그때 playwright.config.ts 가 8797 서버를 띄운다).
// 일꾼은 따로 띄운다. 예(이 저장소에서, bubblewrap·TeX Live 가 깔린 리눅스):
//   npm run build -w compiler && COMPILER_SECRET=e2e-compiler-secret-e2e-compiler-secret-0123 WORK_DIR=/tmp/alldoc-work node compiler/dist/main.js
//   REQUIRE_TEXLIVE=1 npx playwright test e2e/tex-real.spec.ts --project=tex-real
// PDF 의 한글은 pdftotext(poppler-utils)로 원문과 맞춰 본다.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { downloadAs, loginAs, waitForEngine } from './helpers';

test.skip(process.env.REQUIRE_TEXLIVE !== '1', 'REQUIRE_TEXLIVE=1 일 때만 돈다(진짜 컴파일 일꾼 필요)');

function pdftotext(bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'alldoc-pdf-'));
  writeFileSync(join(dir, 'a.pdf'), bytes);
  return execFileSync('pdftotext', ['-enc', 'UTF-8', join(dir, 'a.pdf'), '-'], { encoding: 'utf8' });
}

async function compileButton(page: Page) {
  await page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '확인하고 컴파일' }).click();
}

test('한국어 템플릿을 XeLaTeX 로 컴파일하면 PDF 의 한글이 원문과 맞고, TeX 오류를 눌러 그 줄로 간다', async ({ page }) => {
  test.setTimeout(240_000);
  await loginAs(page);
  await page.goto('/');
  await page.getByRole('button', { name: /한국어 논문\(짧은 글\)/ }).click();
  await waitForEngine(page);
  await expect(page.getByText('데모 컴파일러')).toHaveCount(0);

  await compileButton(page);
  await expect(page.getByTestId('compile-status')).toHaveText(/^완료/, { timeout: 120_000 });
  await expect(page.locator('.tex-pdf-pages canvas').first()).toBeVisible();
  const pdf = await downloadAs(page, /마지막으로 만든 PDF/);
  const text = pdftotext(pdf.bytes);
  for (const phrase of ['논문 제목을 여기에 씁니다', '표 1은 결과를 정리한 것이다', '실험 결과', '더 많은 자료로 실험한다']) expect(text).toContain(phrase);
  await page.screenshot({ path: test.info().outputPath('tex-real-ok.png') });

  // 맨 끝 \end{document} 앞에 없는 명령을 넣는다 → "Undefined control sequence" 가 그 줄에 난다.
  // 템플릿에서 \end{document} 가 몇 번째 줄인지 센다(편집기는 보이는 줄만 그리므로 화면에서 세지 않는다).
  const errLine = readFileSync('templates/latex/ko-article/main.tex', 'utf8').split('\n').indexOf('\\end{document}') + 1;
  expect(errLine).toBeGreaterThan(1);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  // 마지막 줄(빈 줄) 위가 \end{document}
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Home');
  await page.keyboard.type('\\undefinedmacro\n');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('compile-status')).toHaveText(/^오류/, { timeout: 120_000 });
  const item = page.locator('.diag li.error button').first();
  await expect(item).toContainText(`main.tex:${errLine}`);
  await expect(item).toContainText('Undefined control sequence');
  await page.keyboard.press('Control+Home');
  await item.click();
  await expect(page.locator('.cm-activeLine')).toHaveText('\\undefinedmacro');
  await page.screenshot({ path: test.info().outputPath('tex-real-error.png') });
});
