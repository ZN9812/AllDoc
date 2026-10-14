// LaTeX 프로젝트 종단 시험. 서버는 데모 컴파일러(COMPILER=mock)로 뜬다: \begin{itemise} 가 있는 줄은 오류, 그 밖에는 작은 PDF.
// 편집기(CodeMirror)에 글을 넣는 것은 Playwright 의 키 입력이다. 한글 입력기(IME) 조합은 거치지 않는다(손으로 확인할 일).
import { zipSync } from 'fflate';
import { expect, test, type Page } from '@playwright/test';
import { downloadAs, loginAs, openFile, waitForEngine, type Upload } from './helpers';

const enc = new TextEncoder();

/** 첫 컴파일 안내가 나오면 확인한다. */
async function compile(page: Page): Promise<void> {
  await page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible().catch(() => false)) await dialog.getByRole('button', { name: '확인하고 컴파일' }).click();
}

/** 미리보기의 첫 쪽에 글자가 실제로 그려졌는지(어두운 픽셀이 있는지) */
async function expectPdfDrawn(page: Page): Promise<void> {
  await expect(page.locator('.tex-pdf-pages canvas').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForFunction(() => {
    const c = document.querySelector<HTMLCanvasElement>('.tex-pdf-pages canvas');
    if (!c || !c.width) return false;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < d.length; i += 4) if ((d[i] ?? 255) < 128) return true;
    return false;
  });
}

/** 파일 목록에서 그 파일을 연다 */
const openInTree = (page: Page, path: string) => page.locator('.tex-files').getByRole('button', { name: new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).click();

test.describe('LaTeX 프로젝트(데모 컴파일러)', () => {
  test('템플릿 → 편집 → 컴파일 → PDF → 오류를 눌러 다른 파일의 그 줄로 이동', async ({ page }) => {
    await loginAs(page);
    await page.goto('/');
    await page.getByRole('button', { name: /한국어 보고서·학위논문 초안/ }).click();
    await page.waitForURL(/\/edit\//);
    await waitForEngine(page);
    await expect(page.locator('.cm-content')).toContainText('\\documentclass');
    await expect(page.getByRole('combobox', { name: '엔진' })).toHaveValue('xelatex');
    await expect(page.getByRole('combobox', { name: '주 파일' })).toHaveValue('main.tex');

    // 처음 컴파일: 서버로 보낸다는 안내를 한 번 보여 준다.
    await page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('서버로 전송돼요');
    await expect(dialog).toContainText('7일 뒤');
    await dialog.getByRole('button', { name: '확인하고 컴파일' }).click();
    await expect(page.getByTestId('compile-status')).toHaveText('완료');
    await expectPdfDrawn(page);
    // 컴파일 탭의 안내(web/src/editor/coverage.ts 의 texCompileNote)
    await expect(page.getByTestId('coverage-note')).toContainText('마지막으로 쓴 날부터 7일 뒤 지워요');
    await expect(page.getByTestId('coverage-note')).toContainText('AI로 오류 고치기"는 오류·로그와');

    // 하위 파일(chapters/intro.tex)의 첫 줄(\chapter, 줄바꿈 없이 한 줄로 보이는 짧은 줄) 뒤에 오류를 넣고 Ctrl+S 로 다시 컴파일한다.
    await openInTree(page, 'chapters/intro.tex');
    await expect(page.locator('.cm-content')).toContainText('\\chapter{');
    await page.locator('.cm-line').nth(0).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('\\begin{itemise}');
    await page.keyboard.press('Control+s');
    // 두 번째부터는 안내가 나오지 않는다.
    await expect(page.getByTestId('compile-status')).toHaveText('오류 1');
    await expect(page.getByRole('dialog')).toBeHidden();
    const item = page.locator('.diag li.error button');
    await expect(item).toContainText('chapters/intro.tex:2');
    await expect(item).toContainText('Environment itemise undefined');
    // 실패해도 마지막으로 성공한 PDF 는 남아 있다.
    await expect(page.getByText('마지막으로 성공한 PDF예요')).toBeVisible();
    await expect(page.locator('.tex-files .chip.bad')).toHaveText('오류 1');

    // 주 파일로 옮겨 간 뒤 오류를 누르면 intro.tex 의 2번째 줄로 돌아온다.
    await openInTree(page, 'main.tex');
    await expect(page.locator('.cm-content')).toContainText('\\documentclass');
    await item.click();
    await expect(page.locator('.tex-file[aria-current=true] .nm')).toHaveText('chapters/intro.tex');
    await expect(page.locator('.cm-activeLine')).toHaveText('\\begin{itemise}');
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(1);
    await page.screenshot({ path: test.info().outputPath('tex-jump.png') });

    // 고치고 다시 컴파일하면 오류가 사라진다(Ctrl+Enter).
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('compile-status')).toHaveText('완료');
    await expect(page.getByText('마지막으로 성공한 PDF예요')).toBeHidden();

    // 새로 고쳐도 고친 글이 남아 있다(파일별로 이 브라우저에 저장).
    await expect(page.locator('.save-state')).toContainText('이 브라우저에 저장됨');
    await page.reload();
    await waitForEngine(page);
    await openInTree(page, 'chapters/intro.tex');
    await expect(page.locator('.cm-content')).not.toContainText('itemise');

    // 내려받기: 프로젝트 ZIP 에 모든 파일이 들어 있다.
    const zip = await downloadAs(page, /프로젝트 ZIP/);
    expect(zip.name).toBe('한국어 보고서_수정본.zip');
    const names = Object.keys((await import('fflate')).unzipSync(new Uint8Array(zip.bytes))).sort();
    expect(names).toEqual(['LICENSE', 'chapters/intro.tex', 'chapters/method.tex', 'main.tex', 'refs.bib']);
  });

  test('ZIP 을 올리면 latexmkrc 와 밖을 가리키는 경로는 빼고 알린다. 파일을 더하고 이름을 바꾸고 지울 수 있다', async ({ page }) => {
    await loginAs(page);
    const zip: Upload = {
      name: '내 논문.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(
        zipSync({
          '내 논문/paper.tex': enc.encode('\\documentclass{article}\n\\begin{document}\n본문 \\ref{x}\n\\end{document}\n'),
          '내 논문/latexmkrc': enc.encode('$pdflatex = "touch /tmp/pwned";'),
          '내 논문/../escape.tex': enc.encode('x'),
        }),
      ),
    };
    await openFile(page, zip);
    await expect(page.locator('.toast').first()).toContainText('2개 항목을 빼고 열었어요');
    await expect(page.locator('.tex-file .nm')).toHaveText(['paper.tex']);
    await expect(page.getByRole('combobox', { name: '주 파일' })).toHaveValue('paper.tex');

    // 새 파일
    await page.getByRole('button', { name: '새 파일' }).click();
    await page.getByLabel('새 파일 이름').fill('장/서론.tex');
    await page.getByRole('button', { name: '만들기' }).click();
    await expect(page.locator('.tex-file .nm')).toHaveText(['paper.tex', '장/서론.tex']);
    // 밖을 가리키는 이름은 받지 않는다.
    await page.getByRole('button', { name: '새 파일' }).click();
    await page.getByLabel('새 파일 이름').fill('../밖.tex');
    await page.getByRole('button', { name: '만들기' }).click();
    await expect(page.locator('.toast').last()).toContainText('쓸 수 없는 파일 이름');
    await page.getByRole('button', { name: '새 파일' }).click();

    // 이름 바꾸기와 지우기
    await openInTree(page, '장/서론.tex');
    await page.getByRole('button', { name: '이름 바꾸기' }).click();
    await page.getByLabel('바꿀 이름').fill('장/1.tex');
    await page.getByRole('button', { name: '바꾸기' }).click();
    await expect(page.locator('.tex-file .nm')).toHaveText(['paper.tex', '장/1.tex']);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: '지우기' }).click();
    await expect(page.locator('.tex-file .nm')).toHaveText(['paper.tex']);

    // 주 파일은 지울 수 없다.
    await openInTree(page, 'paper.tex');
    await page.getByRole('button', { name: '지우기' }).click();
    await expect(page.locator('.toast').last()).toContainText('주 파일은 지울 수 없어요');

    // 맞지 않는 \ref 는 경고로 나온다.
    await compile(page);
    await expect(page.getByTestId('compile-status')).toHaveText('완료 · 경고 1');
    await expect(page.locator('.diag li.warning')).toContainText('paper.tex:3');
  });

  test('.tex 하나를 올려 컴파일하고, PDF 와 지금 연 .tex 를 내려받는다', async ({ page }) => {
    await loginAs(page);
    await openFile(page, { name: 'memo.tex', mimeType: 'text/x-tex', buffer: Buffer.from('\\documentclass{article}\\begin{document}a\\newpage b\\end{document}\n') });
    await compile(page);
    await expectPdfDrawn(page);
    await expect(page.locator('.tex-pdf-pages canvas')).toHaveCount(2);
    const pdf = await downloadAs(page, /마지막으로 만든 PDF/);
    expect(pdf.name).toBe('memo.pdf');
    expect(pdf.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const tex = await downloadAs(page, /지금 연 파일/);
    expect(tex.bytes.toString('utf8')).toContain('\\newpage');
  });

  test('로그인하지 않으면 컴파일 대신 로그인 안내를 보여 준다', async ({ page }) => {
    await openFile(page, { name: 'a.tex', mimeType: 'text/x-tex', buffer: Buffer.from('\\documentclass{article}\\begin{document}a\\end{document}') });
    await expect(page.locator('#pane-compile')).toContainText('컴파일은 로그인 후에 쓸 수 있어요');
    await expect(page.locator('.tex-pdf')).toContainText('컴파일은 로그인 후에 쓸 수 있어요');
    await page.getByRole('toolbar', { name: '편집 도구' }).getByRole('button', { name: '컴파일', exact: true }).click();
    await expect(page.locator('.toast').first()).toContainText('로그인');
  });
});
