import { expect, type Page } from '@playwright/test';

export interface Upload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export const unique = (): string => Math.random().toString(36).slice(2, 8);

export const textFile = (name: string, text: string): Upload => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });

/** 홈에서 파일을 올려 편집 화면까지 연다. 편집기가 열리지 않는 파일(깨진 파일)은 ready: false 로 기다리지 않는다. */
export async function openFile(page: Page, file: Upload, options: { ready?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('[data-testid=file-input]', file);
  await page.waitForURL(/\/edit\//);
  if (options.ready !== false) await waitForEngine(page);
}

/** 편집기가 문서를 다 열어 "내려받기"가 켜질 때까지(= 편집기가 준비될 때까지) 기다린다. */
export async function waitForEngine(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '내려받기' })).toBeEnabled({ timeout: 30_000 });
}

/** 개발용 로그인(서버가 AUTH_MODE=dev 로 떠 있을 때). 시험마다 다른 사용자로 로그인해 하루 한도가 섞이지 않게 한다. */
export async function loginAs(page: Page, user: string = `u-${unique()}`): Promise<string> {
  const res = await page.request.get(`/api/auth/login?user=${encodeURIComponent(user)}&next=/`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  return user;
}

/** 아주 작은 PDF(영문 Helvetica)를 직접 만든다. 쪽마다 문장 하나. */
export function makePdf(pages: string[]): Upload {
  const objs: string[] = [];
  const add = (s: string): number => objs.push(s);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = add('PLACEHOLDER');
  const kids: number[] = [];
  for (const text of pages) {
    const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from(out, 'latin1') };
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(m.scroll, `가로 넘침: ${JSON.stringify(m)}`).toBeLessThanOrEqual(m.inner);
}
