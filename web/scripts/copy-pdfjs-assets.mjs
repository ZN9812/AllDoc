// pdf.js 가 글꼴이 들어 있지 않은 PDF(특히 한글 문서)와 특수 이미지를 그리는 데 필요한 파일을 public/pdfjs 로 복사한다.
// 이 파일들은 필요할 때만 내려받는다. 복사본은 git 에 올리지 않는다.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'));
const target = join(here, '..', 'public', 'pdfjs');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const from = join(pkgDir, name);
  if (!existsSync(from)) {
    console.warn(`pdfjs-dist/${name} 을(를) 찾을 수 없어 건너뜁니다.`);
    continue;
  }
  cpSync(from, join(target, name), { recursive: true });
}
console.log('pdf.js 보조 파일을 public/pdfjs 로 복사했습니다.');
