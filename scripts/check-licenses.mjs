// 배포물에 들어가는 의존성(개발용 제외)의 라이선스를 모아 보여 주고, 허용 목록에 없는 라이선스가 새로 생기면 실패한다.
// 사용: npm run check:licenses            (목록 보기, 새 라이선스가 있으면 실패)
//       npm run check:licenses -- --json  (기계가 읽을 수 있게 출력)
//
// 허용 목록에 없는 것이 생겼다면 의존성을 바꾸거나, 라이선스를 직접 읽고 판단한 뒤 아래 목록에 이유와 함께 추가하세요.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 문제없이 쓸 수 있다고 본 느슨한 라이선스 */
const PERMISSIVE = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'Unlicense',
  'CC0-1.0',
  'OFL-1.1',
  '(MPL-2.0 OR Apache-2.0)',
]);

/** 눈여겨봐야 하지만 의도해서 쓰는 것. 이유를 적어 둔다(THIRD_PARTY_NOTICES.md 참고). */
const REVIEWED = {
  superdoc: 'AGPL-3.0. 이 저장소를 AGPL-3.0-only 로 공개하는 이유 중 하나. 별도 상용 계약으로 쓸 수도 있다.',
  '@superdoc/docx-engine': '독점(Proprietary) 라이선스. SuperDoc 의 의존성이며 운영 전에 라이선스 확인이 필요하다(THIRD_PARTY_NOTICES.md).',
};

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json --long', { maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const found = new Map();
(function walk(deps) {
  for (const [name, d] of Object.entries(deps ?? {})) {
    if (!name.startsWith('@alldoc/')) found.set(`${name}@${d.version}`, { name, version: d.version, path: d.path, license: d.license ?? d.licenses });
    walk(d.dependencies);
  }
})(tree.dependencies);

const normalize = (l) => (Array.isArray(l) ? l.map((x) => x.type ?? x).join(' OR ') : l && typeof l === 'object' ? l.type : l);
const byLicense = new Map();
const problems = [];
for (const pkg of found.values()) {
  let license = normalize(pkg.license);
  if (!license && pkg.path && existsSync(join(pkg.path, 'package.json'))) {
    const j = JSON.parse(readFileSync(join(pkg.path, 'package.json'), 'utf8'));
    license = normalize(j.license ?? j.licenses);
  }
  // 설치되지 않은 선택 의존성(다른 운영체제용 바이너리 등)은 배포물에 들어가지 않으므로 건너뛴다.
  if (!license && !pkg.path) continue;
  const label = license ?? 'UNKNOWN';
  byLicense.set(label, [...(byLicense.get(label) ?? []), `${pkg.name}@${pkg.version}`]);
  if (REVIEWED[pkg.name]) continue;
  if (!PERMISSIVE.has(label)) problems.push(`${pkg.name}@${pkg.version}: ${label}`);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(byLicense), null, 2));
} else {
  console.log(`배포물 의존성 ${[...byLicense.values()].reduce((n, l) => n + l.length, 0)}개의 라이선스:`);
  for (const [label, names] of [...byLicense].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(names.length).padStart(3)}  ${label}${names.length <= 3 ? `  (${names.join(', ')})` : ''}`);
  }
  for (const [name, why] of Object.entries(REVIEWED)) console.log(`\n주의: ${name} — ${why}`);
}

if (problems.length > 0) {
  console.error(`\n허용 목록에 없는 라이선스가 있어요:\n  ${problems.join('\n  ')}\n라이선스를 읽어 보고 판단한 뒤 scripts/check-licenses.mjs 의 목록에 이유와 함께 추가하세요.`);
  process.exit(1);
}
