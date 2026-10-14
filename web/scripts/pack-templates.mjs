// templates/latex/<이름>/ 폴더를 web/public/templates/<이름>.zip 으로 묶고 목록(index.json)을 만든다.
// 홈 화면의 "LaTeX 새 프로젝트"가 이 목록과 ZIP 을 받아 새 프로젝트를 만든다.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', 'templates', 'latex');
const out = join(here, '..', 'public', 'templates');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const index = [];
for (const id of readdirSync(src).sort()) {
  const dir = join(src, id);
  if (!statSync(dir).isDirectory()) continue;
  const meta = JSON.parse(readFileSync(join(dir, 'template.json'), 'utf8'));
  const files = {};
  for (const f of walk(dir)) {
    const rel = relative(dir, f).split(sep).join('/');
    if (rel === 'template.json') continue;
    // 만든 시각을 고정해 같은 내용이면 같은 ZIP 이 나오게 한다.
    files[rel] = [new Uint8Array(readFileSync(f)), { mtime: new Date('2026-01-01T00:00:00Z') }];
  }
  // 템플릿 라이선스(MIT)를 ZIP 마다 함께 넣는다.
  files.LICENSE = [new Uint8Array(readFileSync(join(src, 'LICENSE'))), { mtime: new Date('2026-01-01T00:00:00Z') }];
  writeFileSync(join(out, `${id}.zip`), zipSync(files, { level: 9 }));
  index.push({ id, title: meta.title, description: meta.description, name: meta.name });
}
writeFileSync(join(out, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`LaTeX 템플릿 ${index.length}개를 묶었어요: ${index.map((t) => t.id).join(', ')}`);
