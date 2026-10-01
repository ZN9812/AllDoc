import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { askAi, downloadAs, loginAs, openFile } from './helpers';

// 다른 프로그램(LibreOffice)으로 만든 DOCX 를 열어 고치고, 내려받은 파일을 다시 LibreOffice 로 열어 확인하는 시험.
// LibreOffice(soffice)가 설치된 환경에서만 돈다(없으면 건너뜀). 우리 쪽 코드가 아니라 제3자 프로그램이 읽는다는 점이 핵심이다.
// 한글(HWP)은 LibreOffice 가 HWP 5.0 을 열지 못해서 이 방식으로 확인할 수 없다.
const SOFFICE = (() => {
  try {
    return execFileSync('which', ['soffice'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();

// CI 에서는 REQUIRE_SOFFICE=1 로, LibreOffice 설치가 빠졌을 때 이 시험이 조용히 건너뛰어지지 않고 실패하게 한다.
const REQUIRED = process.env.REQUIRE_SOFFICE === '1';

test.skip(process.env.VITE_DISABLE_DOCX === '1', 'DOCX 를 끄고 빌드함');
test.skip(!SOFFICE && !REQUIRED, 'LibreOffice(soffice)가 없음');
test.setTimeout(180_000);

const HTML = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>실제 업무 문서</title>
<style>
h1 { font-size: 20pt; text-align: center; }
p.body { font-size: 11pt; line-height: 160%; text-align: justify; }
p.item { font-size: 12pt; }
</style></head><body>
<h1>2026년 하반기 업무 협조 요청</h1>
<p class="body">안녕하세요. 이 문서는 업무 협조를 요청드리기 위한 시험 문서입니다. 몇일 안에 회신해 주시면 감사하겠습니다.</p>
<p class="item">1. 첫째 협조 사항을 안내합니다</p>
<p class="item">2. 둘째 협조 사항을 안내합니다</p>
<p class="item" style="font-size:14pt">3. 셋째 협조 사항을 안내합니다</p>
<table border="1" cellpadding="4"><tr><td>구분</td><td>내용</td></tr><tr><td>기간</td><td>다음 주까지</td></tr></table>
<p class="body">자세한 내용은 첨부를 참고하시기 바랍니다. 할려고 하는 일이 있으면 알려 주세요.</p>
</body></html>`;

/** soffice 를 한 번 실행한다. 동시에 여러 개가 돌아도 부딪치지 않게 실행마다 따로 설정 폴더를 쓴다. */
function soffice(dir: string, args: string[]): void {
  execFileSync(SOFFICE, [`-env:UserInstallation=file://${join(dir, 'profile')}`, '--headless', ...args], { cwd: dir, stdio: 'ignore', timeout: 150_000 });
}

const toText = (dir: string, file: string): string[] => {
  soffice(dir, ['--convert-to', 'txt:Text (encoded):UTF8', '--outdir', join(dir, 'txt'), file]);
  const name = file.replace(/^.*\//, '').replace(/\.[^.]+$/, '.txt');
  return readFileSync(join(dir, 'txt', name), 'utf8').replace(/^﻿/, '').trimEnd().split('\n');
};

test('LibreOffice 로 만든 DOCX 를 고쳐 내려받으면, LibreOffice 가 열었을 때 고친 두 곳 말고는 글이 그대로다', async ({ page }) => {
  expect(SOFFICE, 'LibreOffice(soffice)를 찾을 수 없어요. 설치하거나 REQUIRE_SOFFICE 를 빼세요.').not.toBe('');
  const dir = mkdtempSync(join(tmpdir(), 'alldoc-interop-'));
  writeFileSync(join(dir, 'source.html'), HTML);
  soffice(dir, ['--infilter=HTML (StarWriter)', '--convert-to', 'docx:MS Word 2007 XML', '--outdir', dir, join(dir, 'source.html')]);
  const original = readFileSync(join(dir, 'source.docx'));
  const originalText = toText(dir, join(dir, 'source.docx'));
  expect(originalText).toContain('3. 셋째 협조 사항을 안내합니다');

  await loginAs(page);
  await openFile(page, { name: 'source.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: original });

  // 서식 점검의 제안을 모두 올려 적용한다(실제 문서의 스타일 상속을 읽는 경로).
  await page.getByRole('tab', { name: /서식 점검/ }).click();
  const post = page.getByRole('button', { name: '변경 내역에 올리기' });
  await expect(post).toBeEnabled();
  await post.click();
  await page.getByRole('button', { name: '전체 적용' }).click();
  await expect(page.locator('.toast').last()).toContainText('적용했어요');

  // AI 맞춤법 제안도 적용한다.
  await askAi(page, '맞춤법');
  await page.getByRole('button', { name: '변경 내역 보기' }).click();
  await page.getByRole('button', { name: '전체 적용' }).click();
  await expect(page.locator('.toast').last()).toContainText('2개를 적용했어요');

  const edited = (await downloadAs(page)).bytes;
  writeFileSync(join(dir, 'edited.docx'), edited);

  // 제3자 프로그램이 읽는다: 열리고(변환이 성공하고), 글이 의도한 두 줄만 다르다.
  const editedText = toText(dir, join(dir, 'edited.docx'));
  expect(editedText).toHaveLength(originalText.length);
  const changed = editedText.map((line, i) => [originalText[i], line] as const).filter(([a, b]) => a !== b);
  expect(changed).toEqual([
    [expect.stringContaining('몇일 안에'), expect.stringContaining('며칠 안에')],
    [expect.stringContaining('할려고 하는'), expect.stringContaining('하려고 하는')],
  ]);
  // PDF 로도 열린다.
  soffice(dir, ['--convert-to', 'pdf', '--outdir', join(dir, 'pdf'), join(dir, 'edited.docx')]);
  expect(readFileSync(join(dir, 'pdf', 'edited.pdf')).subarray(0, 5).toString()).toBe('%PDF-');
});
