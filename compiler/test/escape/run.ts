// 탈출 시험 묶음(docs/LATEX.md 의 E2 목록). 진짜 TeX·bubblewrap 으로 runJob 을 돌려 막히는지 본다.
// 컴파일 일꾼 이미지 안에서 그 이미지의 설정(읽기 전용 루트, cap_drop ALL, seccomp 프로필)으로 돌리는 것이 목적이다(CI 의 latex 작업).
//   npm run test:escape -w compiler           (TeX·bwrap 이 없으면 건너뛴다)
//   REQUIRE_TEXLIVE=1 node dist/escape.js       (없으면 실패)
// 환경 변수: SANDBOX(기본 bwrap), WORK_DIR(기본 임시 폴더), SANDBOX_RO_BINDS(일꾼과 같은 기본값)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JobRejected, runJob, validateJob, type JobInput, type RunOptions } from '../../src/run';

const enc = new TextEncoder();
const MB = 1024 * 1024;

function has(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

const sandbox = process.env.SANDBOX === 'none' ? 'none' : 'bwrap';
const missing = [!has('latexmk', ['-v']) && 'latexmk', !has('xelatex', ['--version']) && 'xelatex', sandbox === 'bwrap' && !has('bwrap', ['--version']) && 'bwrap'].filter(Boolean);
if (missing.length > 0) {
  const msg = `탈출 시험: ${missing.join(', ')} 이(가) 없어요.`;
  if (process.env.REQUIRE_TEXLIVE === '1') {
    console.error(`${msg} REQUIRE_TEXLIVE=1 이라 실패로 처리해요.`);
    process.exit(1);
  }
  console.log(`${msg} 건너뛰어요.`);
  process.exit(0);
}

const workRoot = process.env.WORK_DIR ?? mkdtempSync(join(tmpdir(), 'alldoc-escape-'));
mkdirSync(workRoot, { recursive: true });
const opt: RunOptions = {
  workRoot,
  sandbox,
  roBinds: (process.env.SANDBOX_RO_BINDS ?? '/usr,/etc/texmf,/var/lib/texmf,/etc/fonts,/var/cache/fontconfig,/etc/ld.so.cache,/etc/alternatives').split(','),
  memBytes: 2048 * MB,
  fileBytes: 20 * MB,
  nproc: 256,
  logBytes: 2 * MB,
  pdfBytes: 200 * MB,
};

// 일꾼 프로세스의 환경에 넣은 값이 TeX 쪽에서 보이지 않아야 한다.
process.env.ALLDOC_ESCAPE_CANARY = 'canary-7f3a9c';

const doc = (body: string, preamble = '') => `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`;
const job = (files: Record<string, string>, over: Partial<JobInput> = {}): JobInput => ({
  jobId: randomUUID(),
  engine: 'xelatex',
  main: 'main.tex',
  timeoutSec: 30,
  files: Object.entries(files).map(([path, t]) => ({ path, bytes: enc.encode(t) })),
  ...over,
});

class Fail extends Error {}
function ok(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Fail(message);
}

/** 작업 폴더에 남은 파일 목록(하위 폴더 포함) */
function listFiles(dir: string, prefix = ''): Array<{ path: string; size: number }> {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const st = statSync(p);
    return st.isDirectory() ? listFiles(p, `${prefix}${n}/`) : [{ path: `${prefix}${n}`, size: st.size }];
  });
}

const cases: Array<[string, () => Promise<void>]> = [
  [
    '정상 문서(한글·공백·긴 한글 파일 이름)는 컴파일된다',
    async () => {
      const long = '가'.repeat(80);
      const r = await runJob(
        job(
          {
            '논문 원고.tex': doc(`\\input{"장/서론 1"}\\input{${long}}`, '\\usepackage{kotex}'),
            '장/서론 1.tex': '서론이다.\n',
            [`${long}.tex`]: '긴 이름이다.\n',
          },
          { main: '논문 원고.tex' },
        ),
        opt,
      );
      ok(r.status === 'ok', `status=${r.status}\n${r.log.slice(-1500)}`);
      ok(r.pdf && new TextDecoder().decode(r.pdf.subarray(0, 5)) === '%PDF-', 'PDF 가 아니에요');
    },
  ],
  [
    '\\write18 셸 실행이 막힌다',
    async () => {
      let files: string[] = [];
      const r = await runJob(job({ 'main.tex': doc('\\immediate\\write18{touch pwned.txt}x') }), { ...opt, inspect: (d) => void (files = listFiles(d).map((f) => f.path)) });
      ok(!files.includes('pwned.txt'), 'pwned.txt 가 만들어졌어요');
      ok(/runsystem\(touch pwned\.txt\)\.\.\.disabled/.test(r.log), `로그에 disabled 가 없어요\n${r.log.slice(-800)}`);
    },
  ],
  [
    '\\input{/etc/passwd} 로 바깥 파일을 읽지 못한다',
    async () => {
      const r = await runJob(job({ 'main.tex': doc('\\input{/etc/passwd}') }), opt);
      ok(!/root:.*:0:0:/.test(r.log), '로그에 /etc/passwd 내용이 있어요');
      ok(r.status !== 'ok' || !r.pdf || !new TextDecoder('latin1').decode(r.pdf).includes('root:x'), 'PDF 에 /etc/passwd 내용이 있어요');
    },
  ],
  [
    '\\openout 으로 작업 폴더 밖(../, 절대 경로)에 쓰지 못한다',
    async () => {
      const marker = `escaped-${randomUUID()}.txt`;
      await runJob(
        job({ 'main.tex': doc(`\\newwrite\\o\\immediate\\openout\\o=../${marker}\\immediate\\write\\o{x}\\immediate\\closeout\\o \\immediate\\openout\\o=/tmp/${marker}\\immediate\\write\\o{x}\\immediate\\closeout\\o x`) }),
        opt,
      );
      ok(!existsSync(join(workRoot, marker)), '작업 폴더 밖(../)에 파일이 생겼어요');
      ok(!existsSync(join('/tmp', marker)), '/tmp 에 파일이 생겼어요');
    },
  ],
  [
    'LuaTeX: os.execute·io.popen 이 막히고 io.open 으로 /etc/passwd 를 읽지 못한다',
    async () => {
      let files: string[] = [];
      const lua = String.raw`\directlua{
        local ok1, r1 = pcall(os.execute, "touch pwned-lua.txt")
        texio.write_nl("ESC-EXEC=" .. tostring(ok1) .. "/" .. tostring(r1))
        local ok2, p = pcall(io.popen, "id")
        texio.write_nl("ESC-POPEN=" .. tostring(ok2 and p ~= nil))
        local f = io.open("/etc/passwd", "r")
        texio.write_nl("ESC-PASSWD=" .. (f and (f:read("*l") or "") or "nil"))
        texio.write_nl("ESC-ENV=" .. tostring(os.getenv("ALLDOC_ESCAPE_CANARY")))
      }x`;
      const r = await runJob(job({ 'main.tex': doc(lua) }, { engine: 'lualatex', timeoutSec: 120 }), { ...opt, inspect: (d) => void (files = listFiles(d).map((f) => f.path)) });
      ok(r.log.includes('ESC-EXEC='), `lualatex 가 돌지 않았어요(status=${r.status})\n${r.log.slice(-1500)}`);
      ok(!files.includes('pwned-lua.txt'), 'os.execute 로 파일이 만들어졌어요');
      ok(r.log.includes('ESC-POPEN=false'), 'io.popen 이 열렸어요');
      ok(!/ESC-PASSWD=root/.test(r.log), 'io.open 으로 /etc/passwd 를 읽었어요');
      ok(r.log.includes('ESC-ENV=nil'), '일꾼의 환경 변수가 보였어요');
    },
  ],
  [
    '바깥으로 연결하지 못한다(LuaTeX 소켓)',
    async () => {
      const lua = String.raw`\directlua{
        local ok, socket = pcall(require, "socket")
        if not ok or not socket then texio.write_nl("ESC-NET=nosocket") else
          local c = socket.tcp(); c:settimeout(3)
          local res, err = c:connect("1.1.1.1", 80)
          texio.write_nl("ESC-NET=" .. tostring(res) .. "/" .. tostring(err))
        end
      }x`;
      const r = await runJob(job({ 'main.tex': doc(lua) }, { engine: 'lualatex', timeoutSec: 120 }), opt);
      ok(r.log.includes('ESC-NET='), `lualatex 가 돌지 않았어요\n${r.log.slice(-800)}`);
      ok(!r.log.includes('ESC-NET=1/'), '바깥으로 연결됐어요');
    },
  ],
  [
    '다른 작업 폴더의 파일을 읽지 못한다',
    async () => {
      const other = join(workRoot, `other-${randomUUID()}`);
      mkdirSync(other);
      writeFileSync(join(other, 'secret.tex'), 'SIBLING-SECRET-91');
      const name = other.split('/').pop() as string;
      const r = await runJob(job({ 'main.tex': doc(`\\input{../${name}/secret.tex}\\input{${other}/secret.tex}`) }), opt);
      ok(!r.log.includes('SIBLING-SECRET-91'), '로그에 다른 작업의 내용이 있어요');
      ok(!r.pdf || !new TextDecoder('latin1').decode(r.pdf).includes('SIBLING'), 'PDF 에 다른 작업의 내용이 있어요');
    },
  ],
  [
    '무한 반복은 시간 제한에서 강제로 멈춘다',
    async () => {
      const t = Date.now();
      const r = await runJob(job({ 'main.tex': doc('\\def\\a{\\a}\\a') }, { timeoutSec: 5 }), opt);
      ok(r.status === 'timeout', `status=${r.status}`);
      ok(Date.now() - t < 15_000, `멈추는 데 ${Date.now() - t}ms 걸렸어요`);
    },
  ],
  [
    '로그 폭주: 파일 크기 상한과 시간 제한에 걸리고, 돌려주는 로그는 2MB 이하다',
    async () => {
      let biggest = 0;
      const r = await runJob(job({ 'main.tex': doc(`\\loop\\message{${'x'.repeat(200)}}\\iftrue\\repeat`) }, { timeoutSec: 8 }), {
        ...opt,
        inspect: (d) => void (biggest = Math.max(0, ...listFiles(d).map((f) => f.size))),
      });
      ok(r.status !== 'ok', `status=${r.status}`);
      ok(biggest <= opt.fileBytes, `작업 폴더에 ${biggest} 바이트 파일이 생겼어요`);
      ok(Buffer.byteLength(r.log) <= opt.logBytes + 4096, `로그가 ${Buffer.byteLength(r.log)} 바이트예요`);
    },
  ],
  [
    'PDF 폭증: 파일 크기 상한을 넘는 PDF 는 돌려주지 않는다',
    async () => {
      const r = await runJob(job({ 'main.tex': doc('\\loop x\\newpage\\iftrue\\repeat') }, { timeoutSec: 15 }), { ...opt, fileBytes: 2 * MB });
      ok(r.status !== 'ok' || (r.pdf?.byteLength ?? 0) <= 2 * MB, `status=${r.status}, pdf=${r.pdf?.byteLength}`);
    },
  ],
  [
    '메모리: 주소 공간 상한에 걸려 실패하고 일꾼은 살아 있다',
    async () => {
      const lua = String.raw`\directlua{local t = {} for i = 1, 100000 do t[i] = string.rep("x", 1048576) .. i end texio.write_nl("ESC-MEM=done")}x`;
      const r = await runJob(job({ 'main.tex': doc(lua) }, { engine: 'lualatex', timeoutSec: 60 }), { ...opt, memBytes: 512 * MB });
      ok(!r.log.includes('ESC-MEM=done'), '100GB 를 잡았다고 나와요');
      ok(r.status !== 'ok', `status=${r.status}`);
    },
  ],
  [
    'latexmkrc·밖을 가리키는 경로·대소문자만 다른 중복은 받지 않는다',
    async () => {
      const parts = [enc.encode('x')];
      const base = { jobId: randomUUID(), engine: 'xelatex', main: 'main.tex', timeoutSec: 10 };
      for (const files of [['latexmkrc'], ['sub/.latexmkrc'], ['../x.tex'], ['/etc/x.tex']]) {
        let rejected = false;
        try {
          validateJob({ ...base, files }, parts, 600);
        } catch (e) {
          rejected = e instanceof JobRejected;
        }
        ok(rejected, `${files[0]} 를 받았어요`);
      }
      let dup = false;
      try {
        validateJob({ ...base, files: ['main.tex', 'MAIN.tex'] }, [parts[0] as Uint8Array, parts[0] as Uint8Array], 600);
      } catch (e) {
        dup = e instanceof JobRejected;
      }
      ok(dup, '대소문자만 다른 중복을 받았어요');
    },
  ],
];

let failed = 0;
console.log(`탈출 시험(격리: ${sandbox}, 작업 폴더: ${workRoot})`);
for (const [name, fn] of cases) {
  const t = Date.now();
  try {
    await fn();
    console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} (${Date.now() - t}ms)\n    ${e instanceof Error ? e.message.replace(/\n/g, '\n    ') : String(e)}`);
  }
}
console.log(failed === 0 ? `모두 통과(${cases.length}개)` : `${failed}개 실패 / ${cases.length}개`);
process.exit(failed === 0 ? 0 : 1);
