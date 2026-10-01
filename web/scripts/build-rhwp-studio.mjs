// 한글(HWP·HWPX) 편집기 rhwp-studio(MIT)를 정해 둔 버전의 소스에서 빌드해 public/rhwp-studio 에 둔다.
//
// 왜 직접 빌드하나: @rhwp/editor 의 기본 주소는 제3자(GitHub Pages)가 운영하는 편집기라서, 사용자의 문서가
// 그 사이트의 코드가 도는 화면으로 넘어가게 된다. 이 서비스는 편집기 화면도 우리 서버에서 내려주도록 한다.
//
// 동작: 정해 둔 태그·커밋의 소스를 .cache 에 받고(커밋이 다르면 중단), 이미 npm 으로 설치한 @rhwp/core(같은 버전의 WASM)를
// 끼워 넣어 vite 로 빌드한다. 이미 같은 버전이 빌드되어 있으면 건너뛴다.
//
// 편집기 소스에는 "끼워 넣기"만 하는 작은 패치 하나를 적용한다(아래 PATCH). 한글 편집기가 표 칸으로 이동하는 공개 수단을 주지 않아서,
// 편집기 자신의 이동 방식(커서 이동·선택·가운데 스크롤)을 우리 앱이 부를 수 있게 한 함수를 노출한다. 끼울 자리를 하나로 찾지 못하면 패치 없이
// 빌드하고(앱은 표가 있는 곳으로 이동하는 기존 방식으로 돌아간다), RHWP_STUDIO_STRICT=1 이면 빌드를 멈춘다.
//
// 환경 변수: RHWP_STUDIO_SKIP=1 이면 건너뛰고, RHWP_STUDIO_STRICT=1 이면 실패 시 빌드를 멈춘다(기본은 경고만 하고 계속:
// 한글 편집기 없이도 나머지 기능은 쓸 수 있다).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/edwardkim/rhwp.git';
const TAG = 'v0.8.6';
/** 태그가 가리키는 커밋. 태그가 다른 내용으로 바뀌어도 이 값과 다르면 빌드하지 않는다. */
const COMMIT = 'f1f9c6ae58344ee9368996d3543f76b9345cf227';
const CORE_VERSION = '0.8.6';

/** 편집기 소스에 끼우는 패치의 번호. 바뀌면 이미 빌드된 편집기도 다시 빌드한다. */
const PATCH = 'focus-cell-v1';
const PATCH_MARK = `AllDoc 패치: ${PATCH}`;

/**
 * 끼워 넣기 패치. anchor 는 소스에서 정확히 한 곳에만 있어야 한다.
 *  - input-handler.ts: focusBodyParagraph(본문 문단 이동)와 같은 방식으로 표 칸(안쪽 표 포함)으로 이동해 글을 선택하는 메서드
 *  - main.ts: 그 메서드를 window.__alldocFocusCell 로 노출(편집기의 개발용 전역은 배포 빌드에 없다)
 */
const PATCHES = [
  {
    file: ['src', 'engine', 'input-handler.ts'],
    anchor: /^  \/\*\* 현재 커서 위치의 누름틀 필드와 내용을 제거한다\. \*\/$/m,
    snippet: `  /**
   * [${PATCH_MARK}] 표 칸 안의 문단(안쪽 표 포함)으로 캐럿과 뷰포트를 옮긴다. end 가 있으면 [pos.charOffset, end) 를 선택한다.
   * focusBodyParagraph 와 같은 방식(뷰포트 가운데로 스크롤)이다. 칸으로 옮겨졌으면 true.
   */
  focusCellPosition(pos: DocumentPosition, end?: number): boolean {
    try {
      this.exitFootnoteModeForBodyNavigation();
      this.cursor.clearSelection();
      this.cursor.moveTo(pos);
      if (end !== undefined && end > pos.charOffset) {
        this.cursor.setAnchor();
        this.cursor.moveTo({ ...pos, charOffset: end });
      }
      this.cursor.resetPreferredX();
      this.active = true;
      this.updateCaret(true);
      this.focusTextarea();
      const rect = this.cursor.getRect();
      // 요청한 깊이(본문의 표 1, 표 안의 표 2 …)의 칸에 놓였는지 확인한다.
      if (!rect || this.cursor.nestingDepth() !== (pos.cellPath ? pos.cellPath.length : 1)) return false;
      const zoom = this.viewportManager.getZoom();
      const centerY = this.virtualScroll.getPageOffset(rect.pageIndex) + rect.y * zoom;
      const maxScrollTop = Math.max(0, this.container.scrollHeight - this.container.clientHeight);
      this.container.scrollTop = Math.max(0, Math.min(maxScrollTop, centerY - this.container.clientHeight / 2));
      return true;
    } catch {
      return false;
    }
  }

`,
  },
  {
    file: ['src', 'main.ts'],
    anchor: /^([ \t]*)if \(import\.meta\.env\.DEV\) \{\n[ \t]*\(window as any\)\.__inputHandler = inputHandler;/m,
    snippet: `// [${PATCH_MARK}] 호스트 앱이 표 칸으로 이동할 수 있게 노출한다.
(window as any).__alldocFocusCell = (pos: any, end?: number): boolean => inputHandler.focusCellPosition(pos, end);
`,
    indent: true,
  },
];

/**
 * 패치를 적용한다. 먼저 고칠 파일을 받은 그대로(git)로 되돌리므로, 이전 빌드에서 적용한 패치가 남아 겹치는 일이 없다.
 * 끼울 자리를 하나로 찾지 못하면 오류.
 */
function applyPatches(srcDir, studioDir) {
  run('git', ['checkout', '--', ...PATCHES.map((p) => ['rhwp-studio', ...p.file].join('/'))], { cwd: srcDir });
  for (const p of PATCHES) {
    const file = join(studioDir, ...p.file);
    const text = readFileSync(file, 'utf8');
    const matches = [...text.matchAll(new RegExp(p.anchor.source, p.anchor.flags.includes('g') ? p.anchor.flags : `${p.anchor.flags}g`))];
    if (matches.length !== 1) throw new Error(`편집기 패치 자리를 찾지 못했어요(${p.file.join('/')}: ${matches.length}곳). 편집기 버전이 바뀌었는지 확인하세요.`);
    const at = matches[0].index;
    const lead = p.indent ? (matches[0][1] ?? '') : '';
    const snippet = p.indent ? p.snippet.split('\n').map((l) => (l ? lead + l : l)).join('\n') : p.snippet;
    writeFileSync(file, text.slice(0, at) + snippet + text.slice(at));
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');
const repoRoot = join(webDir, '..');
const target = join(webDir, 'public', 'rhwp-studio');
const cache = join(repoRoot, '.cache', 'rhwp-studio');
const src = join(cache, 'src');
const marker = join(target, 'build-info.json');
const require = createRequire(import.meta.url);

function fail(message) {
  if (process.env.RHWP_STUDIO_STRICT === '1') {
    console.error(`한글 편집기 빌드 실패: ${message}`);
    process.exit(1);
  }
  console.warn(`경고: 한글 편집기(rhwp-studio)를 준비하지 못했어요 — ${message}`);
  console.warn('      HWP·HWPX 편집은 이 빌드에서 쓸 수 없고, 나머지 형식은 정상 동작해요. (RHWP_STUDIO_STRICT=1 로 실패 처리할 수 있어요)');
  process.exit(0);
}

/** 명령을 shell 없이 실행한다. npm·npx 는 Windows 에서 .cmd 파일이라 shell 없이는 실행되지 않으므로, 아래에서는 node 로 그 스크립트를 직접 실행한다. */
function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
  if (r.status !== 0) {
    const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-8).join('\n');
    throw new Error(`${cmd} ${args.join(' ')} 실패\n${tail}`);
  }
  return (r.stdout ?? '').trim();
}

if (process.env.RHWP_STUDIO_SKIP === '1') {
  console.log('RHWP_STUDIO_SKIP=1: 한글 편집기 빌드를 건너뜁니다.');
  process.exit(0);
}

try {
  const coreDir = dirname(require.resolve('@rhwp/core/package.json'));
  const coreVersion = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8')).version;
  if (coreVersion !== CORE_VERSION) {
    throw new Error(`@rhwp/core 버전(${coreVersion})이 편집기 소스 버전(${CORE_VERSION})과 달라요. 둘을 함께 올려야 해요.`);
  }

  const want = JSON.stringify({ tag: TAG, commit: COMMIT, core: coreVersion, patch: PATCH });
  if (existsSync(marker) && readFileSync(marker, 'utf8') === want && existsSync(join(target, 'index.html'))) {
    console.log(`한글 편집기(rhwp-studio ${TAG})는 이미 빌드되어 있어요.`);
    process.exit(0);
  }

  console.log(`한글 편집기(rhwp-studio ${TAG})를 빌드합니다…`);
  if (!existsSync(join(src, '.git'))) {
    rmSync(src, { recursive: true, force: true });
    mkdirSync(cache, { recursive: true });
    run('git', ['clone', '--depth', '1', '--branch', TAG, '--filter=blob:none', '--sparse', REPO, src]);
  }
  run('git', ['sparse-checkout', 'set', 'rhwp-studio', 'npm/editor', 'npm/hwpctrl-ocx', 'assets/fonts'], { cwd: src });
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: src });
  if (head !== COMMIT) throw new Error(`받은 소스의 커밋(${head})이 정해 둔 커밋(${COMMIT})과 달라서 중단해요.`);

  const studio = join(src, 'rhwp-studio');
  const studioVersion = JSON.parse(readFileSync(join(studio, 'package.json'), 'utf8')).version;
  if (studioVersion !== CORE_VERSION) throw new Error(`편집기 소스 버전(${studioVersion})이 ${CORE_VERSION} 이 아니에요.`);

  // 같은 버전의 WASM 을 소스가 기대하는 자리(pkg)에 둔다.
  const pkg = join(src, 'pkg');
  rmSync(pkg, { recursive: true, force: true });
  mkdirSync(pkg, { recursive: true });
  for (const f of ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts']) cpSync(join(coreDir, f), join(pkg, f));

  if (!existsSync(join(studio, 'node_modules', '.package-lock.json'))) {
    // npm 으로 실행 중이면 그 npm 을 node 로 직접 부른다(shell 이 필요 없다). 직접 실행한 경우에만 PATH 의 npm 을 쓴다(Windows 는 shell 필요).
    const npmCli = process.env.npm_execpath;
    if (npmCli && /\.c?js$/.test(npmCli)) run(process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund'], { cwd: studio });
    else run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: studio, shell: process.platform === 'win32' });
  }

  applyPatches(src, studio);

  // 서비스 워커(PWA)는 빼고, 경로는 /rhwp-studio/ 아래로 둔다.
  writeFileSync(
    join(studio, 'vite.config.selfhost.mjs'),
    `import base from './vite.config.ts';
const flat = (list) => list.flatMap((p) => (Array.isArray(p) ? flat(p) : [p]));
const plugins = flat(base.plugins ?? []).filter((p) => !String(p?.name ?? '').toLowerCase().includes('pwa'));
export default { ...base, base: '/rhwp-studio/', plugins };
`,
  );
  const out = join(cache, 'dist');
  rmSync(out, { recursive: true, force: true });
  const viteBin = join(studio, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(viteBin)) throw new Error('편집기 소스에 vite 가 설치되어 있지 않아요(npm ci 가 끝나지 않았을 수 있어요).');
  run(process.execPath, [viteBin, 'build', '--config', 'vite.config.selfhost.mjs', '--outDir', out, '--emptyOutDir'], {
    cwd: studio,
    env: { ...process.env, RHWP_DISABLE_EXTERNAL_WEBFONTS: '1', VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' },
  });
  if (!existsSync(join(out, 'index.html'))) throw new Error('빌드 결과에 index.html 이 없어요.');

  // 예제 문서는 배포하지 않는다. 라이선스 문서는 함께 둔다(MIT·글꼴 라이선스 고지).
  rmSync(join(out, 'samples'), { recursive: true, force: true });
  for (const [from, to] of [
    [join(src, 'LICENSE'), 'LICENSE'],
    [join(src, 'THIRD_PARTY_LICENSES.md'), 'THIRD_PARTY_LICENSES.md'],
    [join(src, 'assets', 'fonts', 'FONTS.md'), 'FONTS.md'],
  ]) {
    if (existsSync(from)) cpSync(from, join(out, to));
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(out, target, { recursive: true });
  writeFileSync(marker, want);
  console.log('한글 편집기 빌드를 마쳤어요.');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
