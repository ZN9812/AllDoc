# LaTeX(논문) 편집 설계

Overleaf 처럼 LaTeX 프로젝트를 편집하고, 서버에서 컴파일한 PDF 를 바로 보고, AI 가 고칠 곳을 **제안**하는 기능의 설계입니다.
**M2(편집·컴파일, AI 없음)를 구현했습니다(2026-10-14).** 무엇을 만들었고 설계와 무엇이 다른지, 무엇을 확인하지 못했는지는 바로 아래 "구현 상태 (M2)" 에 있습니다. M3(AI)는 아직입니다. 측정하기 전의 값(이미지 크기 등)은 비워 둡니다.
제품화 순서와 요금제는 `docs/PRODUCT.md` 를 봅니다.

정해진 것:
- 컴파일은 **서버**에서 합니다(브라우저 WASM 엔진은 쓰지 않음).
- 첫 버전은 **혼자 쓰는 편집기**입니다(실시간 공동 편집은 나중).
- AI 는 지금처럼 **제안 → 사용자가 적용** 방식입니다.

## 구현 상태 (M2, 2026-10-14)

**만든 것**
- 문서 종류 `tex`(`shared/src/doc.ts`), IndexedDB 버전 2 와 `texFiles` 저장소(`web/src/lib/docs.ts`), ZIP 가져오기·내보내기와 안전 검사(`web/src/lib/texProject.ts`: `..`·절대 경로·심볼릭 링크·암호화 항목·latexmkrc 빼기, 파일 수·전체 크기 상한, 1MB 넘는 항목의 압축률 100배 초과면 거절).
- 편집 화면(`web/src/engines/TexEngine.tsx`): 파일 목록(새 파일·올리기·이름 바꾸기·지우기·주 파일 정하기) | CodeMirror 원고(`web/src/engines/tex/cm.ts`) | PDF 미리보기(`web/src/engines/pdf/PdfView.tsx`, PDF 문서 보기와 같이 씀). 엔진·주 파일 고르기, `Ctrl/Cmd+S`·`Ctrl/Cmd+Enter` 컴파일, 휴대폰의 "파일 / 원고 / PDF" 전환, 처음 컴파일할 때 안내, 컴파일 탭(`web/src/editor/CompilePane.tsx`: 오류·경고 → 그 파일·줄로 이동, 원본 로그), 내려받기(프로젝트 ZIP·지금 연 .tex·마지막 PDF). 자동 저장은 엔진의 `persist()` 로 바뀐 파일만 씁니다.
- 서버(`server/src/tex/`): 이 사용자가 올린 해시만 대조, 해시 다시 확인, 본인만 PDF, 사용자당 동시 1개, 서버 전체 동시 수·대기열(꽉 차면 503 + `Retry-After`), 요금제의 컴파일 한도(`compileTimeoutSec`·`compilesPerDay`·`compileSecondsPerDay`·`projectMaxBytes`), 한 시간 결과 캐시, `compile_events` 원장(마이그레이션 4), 보관 기간 뒤 정리, 탈퇴 시 기록 삭제·원장 가명화. `COMPILER=mock` 데모 컴파일러.
- 로그 해석(`shared/src/tex/log.ts`): 이 기계에서 모은 실제 XeLaTeX 로그 3개와 BibTeX·Biber `.blg` 로 시험.
- 템플릿 4개(`templates/latex/`), 컴파일 일꾼(`compiler/`: 서명 확인, 작업 검사, bubblewrap + prlimit + 시간 제한), 탈출 시험 12개(`compiler/test/escape/run.ts`), seccomp 프로필(`compiler/seccomp.json`), compose 의 `compiler` 서비스, CI `latex` 작업(`.github/workflows/latex.yml`).
- 종단 시험: `e2e/tex.spec.ts`·`e2e/tex.phone.spec.ts`(데모 컴파일러), `e2e/tex-real.spec.ts`(`REQUIRE_TEXLIVE=1`, 진짜 일꾼).

**설계와 다르게 한 것**
- 앱 → 일꾼 요청은 tar 대신 **작업 묶음**(머리 JSON + 덩어리, `shared/src/tex/frame.ts`)으로 보내고, PDF 도 같은 응답에 담습니다(`GET /compile/:jobId/pdf` 없음). 일꾼은 응답을 보낸 뒤 바로 작업 폴더를 지웁니다.
- 일꾼 이미지의 TeX Live 는 `install-tl` 연도 스냅숏이 아니라 **Debian bookworm 패키지(TeX Live 2022)** 입니다(결정 필요).
- `DocMeta.project` 에 `bib` 는 두지 않았습니다. biber·bibtex 는 latexmk 가 고릅니다.
- tex 는 M3 전까지 `isAiTarget` 이 거짓입니다(AI 대화 탭도 없음).
- 오류가 있으면 TeX 가 만든 PDF 가 있어도 돌려주지 않습니다. 결과 캐시는 서버 메모리에만 있어 서버를 다시 켜면 사라집니다. 대기열 우선순위(`queuePriority`)는 없습니다(먼저 온 순서).
- latexmk 는 `-cd` 로 주 파일이 있는 폴더에서 돌립니다(주 파일이 하위 폴더에 있어도 상대 경로가 맞도록). 안전한 `-r` 설정 파일은 쓰지 않습니다(`-norc` 만).

**확인한 것**(이 환경에서 한 번 해 본 것이며 CI 에서는 돌지 않는다. CI 의 `latex` 작업이 같은 시험을 일꾼 이미지 안에서 돌리도록 해 두었다)
- 이 기계(Ubuntu 24.04, TeX Live 2023 패키지, root)에서 일꾼을 직접 띄워: 탈출 시험 12개 통과, bwrap 을 끄면 1개, TeX 설정을 풀면 2개가 실패(두 겹이 따로 막음). `e2e/tex-real.spec.ts` 통과: ko-article 을 XeLaTeX 로 컴파일한 PDF 를 `pdftotext` 로 읽어 한글 구절 4개가 원문과 같았고, 넣은 `\undefinedmacro` 오류가 그 줄 번호로 나와 누르면 그 줄로 갔습니다(화면 캡처로 봄).
- 데모 컴파일러로 종단 시험 5개(데스크톱 4, 휴대폰 1)와 기존 종단 시험 전체가 통과했습니다(수치는 커밋 메시지).

**CI 에서 처음 알게 된 것**
- 일꾼 이미지 안에서 Docker 의 기본 AppArmor 프로필이 bubblewrap 의 mount 를 막았습니다(`Failed to make / slave: Permission denied`). 일꾼 컨테이너에 `apparmor=unconfined` 를 주는 것으로 바꿨습니다(`docs/DEPLOY.md` "LaTeX 컴파일"). E3 는 AppArmor 가 없는 기계에서 해서 이 문제를 보지 못했습니다.
- 일꾼 이미지 크기는 1.34GB 였습니다(CI 의 `docker image ls`). 이미지 안 TeX Live 2022 의 LuaLaTeX 는 `\directlua{…}` 안에 바로 쓴 여러 줄 Lua 를 이 기계(2023)와 다르게 펼쳐서, 탈출 시험의 Lua 코드를 따로 `.lua` 파일로 두게 바꿨습니다.
- 그때 탈출 시험 12개 중 7개가 TeX 가 아예 돌지 않았는데도 "막혔다"로 통과했습니다. 이제 모든 경우에 TeX 가 실제로 돌았는지(엔진 첫 줄, 시간 제한은 `main.log` 생성) 먼저 확인하고, 격리 도구가 시작하지 못하게 일부러 망가뜨리면 11개가 실패하는 것을 이 기계에서 봤습니다.

**확인하지 못한 것**
- 일꾼 **이미지 빌드와 컨테이너 안 실행**은 이 환경에서 못 했습니다(Docker Hub 429 로 기본 이미지를 받지 못함). CI 의 `latex` 작업 결과로 확인합니다. AppArmor 가 사용자 이름공간을 막는 서버, gVisor.
- 한글 입력기(IME)로 원고에 한글 치기(데스크톱 크롬·사파리, 휴대폰). Playwright 는 입력기를 거치지 않습니다.
- biber 원격 자료, 그림·참고문헌이 많은 실제 논문의 컴파일 시간, LuaLaTeX 의 첫 컴파일 시간(이미지에서 글꼴 캐시를 미리 만들게 했지만 재지 않음).
- 탈출 시험의 "시간 제한 강제 종료"와 "메모리 상한"은 보호를 꺼서 실패하는지 보지 않았습니다(끄면 무한 반복이나 기계 메모리 고갈이 되어서).

**사용자가 정할 것**
- 컴파일 한도의 실제 값(지금은 임시: 60초, 횟수·시간 제한 없음, 50MB)과 무료 사용자에게 컴파일을 줄지, 보관 날 수(지금 7일).
- 템플릿 라이선스(CC0 또는 MIT).
- 일꾼 이미지의 TeX Live 출처(Debian 패키지 유지 또는 `install-tl` 연도 스냅숏).

## 완료 기준 (G3)

- **M2(편집·컴파일)**:
  - XeLaTeX + kotex 한국어 템플릿을 서버에서 컴파일한 PDF 의 한글이 `pdftotext` 로 원문과 맞습니다.
  - 아래 탈출 시험이 CI 에서 모두 막힙니다.
  - 종단 시험이 통과합니다: 열기 → 편집 → 컴파일 → PDF 표시 → 오류 눌러 해당 줄로 이동
  - 데스크톱 크롬·사파리에서 한글 입력을 손으로 확인합니다(휴대폰은 "확인 못 함"으로 적음).
  - PDF 보기 분리 후에도 `e2e/pdf.spec.ts` 가 통과합니다.
- **M3(AI)**:
  - 서버 검증 규칙마다 "규칙을 끄면 실패하는" 시험이 있습니다.
  - 데모 AI 로 "오류 고치기 → 적용 → 다시 컴파일" 종단 시험이 통과합니다.
  - 실제 프로젝트 몇 개로 진짜 Claude 를 써서 측정해 이 문서에 적습니다: 제안 탈락률, 고친 뒤 컴파일 성공률

## 화면에서 하는 일

- **시작**: 홈에서 "LaTeX 새 프로젝트(템플릿 선택)"를 고르거나 `.tex`·`.zip` 을 올립니다.
- **편집 화면**:
  - 배치: 왼쪽 파일 목록 | 가운데 원고 | 오른쪽 PDF 미리보기
  - 휴대폰: "파일 / 원고 / PDF" 를 전환합니다.
  - 컴파일: 단추, `Ctrl/Cmd+S`, `Ctrl+Enter` 로 합니다. 엔진(pdfLaTeX·XeLaTeX·LuaLaTeX)과 주 파일을 고를 수 있습니다.
  - 상태 표시: "컴파일 중… 12초", "오류 3"
- **오른쪽 탭**(tex 일 때): AI 대화 · **컴파일** · 변경 내역
  - 컴파일 탭: 오류·경고 목록(파일:줄)을 누르면 그 파일·줄로 이동합니다.
  - 원본 로그를 볼 수 있고, "AI로 오류 고치기" 단추가 있습니다.
- **내려받기**: 프로젝트(ZIP), 지금 연 `.tex`, 마지막으로 성공한 PDF
- **처음 컴파일할 때 안내**: "프로젝트 파일이 컴파일을 위해 서버로 전송되고 N일 뒤 지워집니다"
  - 지금의 "서버는 문서를 저장하지 않습니다"(README, `docs/AI.md`, `docs/DEPLOY.md`)와 다르므로, 이 기능을 넣는 변경에서 함께 고칩니다.

## 데이터 모델

새 문서 종류 `tex`(LaTeX 프로젝트)를 둡니다.

| 방식 | 자동 저장 비용 | 결정 |
| --- | --- | --- |
| 프로젝트 전체를 ZIP 하나로 | 0.8초마다 전체를 다시 묶음(그림이 크면 느림) | 쓰지 않음 |
| **파일별 레코드 + 처음 올린 ZIP 은 원본으로 보관** | 바뀐 파일만 씀 | **채택** |

- **`shared/src/doc.ts`**:
  - `DOC_KINDS` 에 `'tex'` 를 추가합니다. `.tex` 하나를 올리면 파일 하나짜리 프로젝트가 됩니다.
  - `isAiTarget` 은 참, `isFormatKind` 는 거짓입니다.
  - `.zip` 은 종류가 아니라 가져오기 경로입니다. `.tex` 가 들어 있을 때만 받습니다(`web/src/lib/files.ts`).
  - 안내 문구도 고칩니다(`web/src/lib/features.ts` 의 `SUPPORTED_FORMATS_TEXT`·`ACCEPT`).
- **`web/src/lib/docs.ts`**:
  - DB 버전을 2 로 올리고 `texFiles` 저장소를 추가합니다.
    - 키: `${docId}/${path}`
    - 값: `{docId, path, blob, hash, updatedAt}`
    - 색인: `by-doc`
  - `DocMeta.project = { main, engine, bib }` 를 추가합니다.
  - tex 는 `working` 블롭이 없을 수 있으므로 `getDoc` 이 원본으로 대신합니다.
  - `removeDoc` 은 `texFiles` 범위도 지웁니다.
- **`web/src/lib/texProject.ts`(새로)**:
  - 함수: ZIP·템플릿으로 프로젝트 만들기, 파일 목록·읽기·쓰기(sha256 갱신)·이름 바꾸기·삭제, ZIP 내보내기, 원본으로 되돌리기
  - 올릴 때 거르는 것:
    - `..`·절대 경로·심볼릭 링크
    - 개수·크기 상한, 압축률 100배 초과(zip 폭탄)
    - `latexmkrc`·`.latexmkrc`(펄 코드라서 빼고 알림)
- **ZIP 라이브러리**: 읽기·쓰기 모두 `fflate`(MIT)로 합니다. 지금의 `web/src/engines/docx/zip.ts` 는 이름을 지정한 몇 파일만 읽습니다.
- **엔진 연결 약속**(`web/src/engines/types.ts`): 선택 함수 `persist?()` 를 추가합니다.
  - `EditorPage` 의 자동 저장이 이 함수가 있으면 이것을 부르고(바뀐 파일만 저장), 없으면 지금처럼 `getBlob` + `saveWorking` 을 씁니다.
  - tex 의 `getBlob()` 은 내려받기용 ZIP 을 돌려줍니다.
- **엔진 등록**:
  - `web/src/engines/registry.ts` 에 `tex: lazy(() => import('./TexEngine'))` 를 추가합니다.
  - `web/src/engines/headless.ts` 는 tex 를 기준 문서로 쓸 수 없다고 알립니다.

## 편집기

- **코드 편집기**: CodeMirror 6(MIT)을 tex 에서만 늦게 불러옵니다.
  - 패키지: `@codemirror/{state,view,commands,language,search,lint,legacy-modes}`, `legacy-modes` 의 `stex` 로 구문 색을 칠합니다.
  - TXT·MD 는 지금의 `TextEngine` 을 그대로 씁니다.
  - 강조는 CodeMirror 꾸밈(decoration)으로, 오류 표시는 lint 로 합니다.
- **위험: 한글 입력기(IME) 조합**(데스크톱 크롬·사파리, 안드로이드 삼성 키보드)
  - Playwright 의 `insertText` 는 입력기를 거치지 않으므로 손으로 확인합니다.
- **PDF 미리보기**: `web/src/engines/PdfEngine.tsx` 의 그리기 부분을 `web/src/engines/pdf/PdfView.tsx`(바이트를 받는 컴포넌트)로 분리해 PDF 문서와 LaTeX 가 같이 씁니다.
  - pdf.js 는 받은 버퍼를 작업 스레드로 넘기므로 사본(`bytes.slice()`)을 넘기고 원본은 내려받기용으로 둡니다.
  - 다시 컴파일해도 스크롤 위치를 유지합니다.
- **오른쪽 탭**: `web/src/editor/SidePanel.tsx` 의 탭을 문서 종류에 따라 바꿉니다. 새 `web/src/editor/CompilePane.tsx` 를 만듭니다.
- **SyncTeX**: 처음부터 `-synctex=1` 로 컴파일해 `.synctex.gz` 를 남깁니다. 원고↔PDF 위치 이동은 M7 입니다(해석기 라이선스 확인).

## 컴파일 서버

### 구성

- **분리**: 본 서버와 분리된 **컴파일 일꾼**을 둡니다(새 워크스페이스 `compiler/`, 별도 이미지).
  - 본 서버가 맡는 일: 인증·한도·크기 확인, 대기열
  - 본 서버는 내부망으로 일꾼에게 일을 넘깁니다.
- **docker 소켓은 어디에도 넘기지 않습니다.**
- **일꾼이 갖지 않는 것**: 비밀값, DB, 파일 저장소. 앱이 작업마다 그 작업의 파일만 보냅니다. 격리가 뚫려도 그 작업의 파일만 드러납니다.
- **늘리기**: `COMPILER_URLS` 를 목록으로 받아 일꾼을 다른 서버로 늘릴 수 있게 합니다.

### 이미지

- **TeX Live**: 연도 스냅숏을 고정해 `install-tl` 로 설치합니다(`scheme-custom`, 문서·소스 제외).
  - 넣을 묶음(초안): basic, latex, latexrecommended, latexextra, fontsrecommended, mathscience, pictures, plaingeneric, bibtexextra, binextra(latexmk), xetex, luatex, **langkorean**, langcjk, langenglish, publishers
  - fontsextra 는 처음엔 뺍니다.
  - 참고로 Debian 의 `texlive-lang-korean` 패키지는 설치 크기가 약 60MB 로 나와 있습니다(packages.debian.org, sid). 전체 이미지 크기는 **측정 전이라 적지 않습니다.**
- **글꼴**(OFL): Noto Serif/Sans CJK KR, 나눔명조·나눔고딕. 빌드 때 `fc-cache` 를 돌립니다.
- **빌드 때 미리 만들 것**: 포맷 파일, LuaTeX 글꼴 캐시(`fmtutil-sys --all`, `luaotfload-tool -u`). 루트가 읽기 전용이라 작업마다 다시 만들지 않게 합니다.
- **배포**: 이미지는 GHCR 에 고정 다이제스트로 올립니다. 앱 이미지는 영향을 받지 않습니다.
- **Tectonic 은 1차에서 쓰지 않습니다**: 네트워크로 패키지를 받아 "네트워크 없음" 원칙과 맞지 않고, kotex 지원도 확인하지 못했습니다.

### 엔진

- **한국어 템플릿**: XeLaTeX + kotex 를 기본으로 하고, 글꼴을 명시합니다(예: `\setmainhangulfont{Noto Serif CJK KR}`). 이 조합이 맞는지는 E1 에서 확인합니다.
- **영어 템플릿**: pdfLaTeX
- **LuaLaTeX + luatexko**: 제공은 하되, 느린지 E1 에서 잽니다.

### 격리

- **바깥층**(컨테이너, `docker-compose.yml` 의 `compiler` 서비스):
  - 내부망만 씁니다(`internal: true`). 포트는 밖으로 열지 않습니다.
  - 파일 시스템: `read_only` 루트, `/work`·`/tmp` 는 용량 상한이 있는 tmpfs
  - 권한: `cap_drop: [ALL]`, `no-new-privileges`, 권한 없는 사용자
  - 자원: `pids_limit`·`mem_limit`·`cpus` 를 겁니다.
  - 가능하면 gVisor(`runtime: runsc`)를 씁니다.
- **안쪽층**(작업마다): bubblewrap 으로 감쌉니다(네트워크 없음, PID 분리, 환경변수 비움, 작업 폴더만 쓰기).

  ```
  bwrap --unshare-all --die-with-parent --new-session --clearenv \
    --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin \
    --ro-bind <texlive> <texlive> --ro-bind /etc/fonts /etc/fonts \
    --bind /work/<job> /w --tmpfs /tmp --dev /dev --chdir /w \
    --setenv PATH /usr/bin --setenv HOME /tmp --setenv TEXMFVAR /tmp/texmf-var --setenv max_print_line 10000 \
    --setenv shell_escape f --setenv openin_any p --setenv openout_any p \
    prlimit --as=<mem> --cpu=<sec> --fsize=<max> --nproc=64 -- \
    latexmk -norc -r /etc/safe-latexmkrc -<engine> -interaction=nonstopmode -file-line-error -synctex=1 <main>
  ```

  - 시간 제한: Node 일꾼이 벽시계 시간을 재고, 넘으면 프로세스 묶음을 강제 종료합니다.
  - `--proc /proc` 는 넣지 않습니다. 컨테이너 안에서 붙이려면 Docker 의 `systempaths=unconfined` 가 필요한데, TeX 는 `/proc` 없이 컴파일됩니다(E3).
  - **Docker 기본 seccomp 로는 bubblewrap 이 사용자 이름공간을 만들지 못합니다**(E3). 컨테이너에는 기본 프로필에 `unshare` `setns` `mount` `umount2` `pivot_root` `clone` `clone3` 만 더한 seccomp 프로필을 줍니다. 운영 서버의 커널(AppArmor)이 권한 없는 사용자 이름공간을 막으면 nsjail(Apache-2.0)을 쓰거나 작업마다 컨테이너를 띄우는 별도 실행기를 둡니다.
  - TeX 설정(아래)은 `texmf.cnf` 를 고치지 않고 환경변수로도 줄 수 있어 위 명령에 넣었습니다(E3 에서 `shell_escape`·`openin_any`·`openout_any` 가 적용되는 것을 확인).
- **TeX 설정**: `shell_escape = f`, `openin_any = p`, `openout_any = p` 로 둡니다.
  - `latexmk -norc` 로 프로젝트의 `latexmkrc`(셸 실행을 다시 켤 수 있는 펄 코드)를 실행하지 않습니다.
  - 알려진 한계: EPS→PDF 자동 변환(제한된 셸 실행)은 꺼집니다.
- **한도**(요금제에서 받음): 컴파일 시간 제한, 프로젝트 크기, PDF 크기, 로그 크기(2MB, 끝부분만 돌려줌), 사용자당 동시 1개, 전체 대기열 길이
  - 무료 시간 제한은 Overleaf(무료 10초, 유료 240초)를 그대로 따르지 않습니다. E1 에서 잰 한국어 XeLaTeX 시간을 보고 정합니다.

### API

- **브라우저 → 앱**(`server/src/tex/routes.ts`):
  1. `POST /api/tex/blobs/check {hashes}`: **이 사용자가 아직 올리지 않은** 해시만 돌려줍니다(다른 사람 파일이 있는지 알 수 없게).
  2. `PUT /api/tex/blobs/:hash`: 원본 바이트를 받습니다. 본문 상한은 요금제에서 받습니다(AI 경로의 4MB 와 별개). 서버가 sha256 을 다시 확인합니다.
  3. `POST /api/tex/compile {engine, main, bib, files: [{path, hash, size}]}`
     - 확인하는 것: 로그인, 약관 동의, 권한, 크기
     - 처리: 사용자당 동시 1개, 우선순위 대기열(꽉 차면 503 `busy` + `Retry-After`)
     - 결과 캐시 키: `sha256(목록 + 엔진 + TeX Live 판)`
  4. `GET /api/tex/output/:jobId.pdf`: 본인만, `no-store`
- **앱 → 일꾼**:
  - `POST /compile` 으로 tar(작업 파일 + 목록 JSON)를 보냅니다. HMAC 헤더로 서명합니다(`COMPILER_SECRET`).
  - 결과는 `{status, diagnostics, logTail, timings}` 입니다.
  - PDF 는 `GET /compile/:jobId/pdf` 로 받습니다. 받은 뒤 또는 60초 뒤 작업 폴더를 지웁니다.
- **시험용**: `server/src/tex/client.ts` 의 `CompilerClient` 인터페이스에 `HttpCompilerClient` 와 `MockCompilerClient` 를 둡니다.
  - `COMPILER=mock` 이면 정해진 PDF 와 로그를 돌려줍니다.
  - AI 연결부처럼 `AppDeps` 로 주입합니다.
- **보관**: 컴파일 캐시 파일은 마지막 사용 후 N일 뒤 지웁니다(예: 7일). 프로젝트마다 "컴파일 뒤 서버에 남기지 않기"를 고를 수 있습니다.
- **다음 단계**: 중간 파일(`.aux .bbl .toc …`)을 사용자·프로젝트별로 보관했다 다시 보내 재컴파일 횟수를 줄입니다(M7).

### 로그 해석

- **위치**: `shared/src/tex/log.ts` 에 직접 만듭니다.
- **읽는 형식**:
  - `-file-line-error` 를 켜면 `./ch1.tex:42: Undefined control sequence.` 형식이 됩니다.
  - `max_print_line=10000` 으로 줄바꿈을 막습니다.
  - 경고(`LaTeX Warning: … on input line 57.`, overfull/underfull)는 괄호로 표시되는 파일 순서를 따라가서 어느 파일인지 찾습니다.
  - biber·bibtex 의 `.blg` 도 읽습니다.
- **시험 자료**: E1 에서 모은 **실제 로그**로 시험합니다.

## LaTeX AI

### 블록 모델 (`shared/src/tex/chunk.ts`, 웹과 서버가 같이 씀)

- **블록 나누기**: `.tex` 파일을 빈 줄 기준 블록으로 나눕니다. LaTeX 의 문단 단위와 같습니다.
  - `text/model.ts` 처럼 줄 단위로 나누면 줄바꿈한 문장이 여러 줄에 걸쳐 쓸 수 없습니다.
- **블록 종류**:

  | 종류 | 처리 |
  | --- | --- |
  | 서문 | 주 파일의 `\begin{document}` 앞부분 |
  | 주석 | `%` 로만 된 블록 |
  | 수식 | 별도 줄 수식 환경 |
  | verbatim | verbatim·lstlisting·minted. **보내지도 고치지도 않음** |
  | 본문 | 나머지 |
  | bib | `.bib` 파일의 `@항목` 하나가 블록 하나 |

- **번호**: `파일칸 × 100000 + 순번` 입니다.
  - 파일칸은 프로젝트를 열 때 정하고, 새 파일은 다음 칸을 받습니다.
  - 그래서 한 파일을 고쳐도 다른 파일의 제안이 낡지 않습니다.
  - `Op.paragraph` 에는 상한이 없어 `shared/src/ops.ts` 는 바꾸지 않습니다.
- **지문**: `textGuard(블록 글)` 를 그대로 씁니다. `applyAtomic`·`rebaseGuards` 도 그대로 동작합니다.
- **위치 정보**: `shared/src/style.ts` 에 `SourcePlace = {file, line, role}` 를 추가하고 `ParagraphInfo.src` 에 둡니다.
  - 위치 문구는 "chapters/intro.tex 42행" 처럼 씁니다.
  - `src` 문단은 본문으로 봅니다.
  - `web/src/ai/guards.ts` 의 `attachPlaces` 가 이를 처리합니다.

### 보내는 범위

- 논문은 `MAX_DOC_CHARS`(12만 자)를 넘기 쉽습니다.
- 대화 창에서 범위를 고릅니다: **지금 파일**(기본) · 선택 영역 · 프로젝트 전체(요금제의 `aiMaxDocChars` 까지). 원가를 조절하는 수단이기도 합니다.

### 변경과 서버 검증

- **변경 종류**: `replaceText` 만 씁니다. `find` 에 줄바꿈이 들어갈 수 있고, 프롬프트에 그대로 베끼라고 적습니다.
- **검증 위치**: `shared/src/tex/check.ts` 를 `server/src/ai/convert.ts` 의 `convertOp` 가 tex 일 때 부릅니다. 클라이언트와 똑같이(첫 `indexOf`) 블록에 적용해 보고 앞뒤를 비교합니다.
- **엄격 모드**(대화·다듬기): 다음 중 하나라도 바뀌면 제안을 버립니다.
  1. 이스케이프되지 않은 중괄호 짝
  2. `\begin{X}`/`\end{X}` 순서
  3. `\label`·`\ref`·`\eqref`·`\autoref`·`\cref`·`\cite` 계열 키 묶음
  4. 수식 구간(`$…$`, `$$…$$`, `\(…\)`, `\[…\]`, 수식 환경). 지시에 수식이 언급되면 예외입니다.
  5. 제어어 묶음. `\emph`·`~`·`\,` 같은 작은 허용 목록은 예외입니다.
  6. 수식 밖의 이스케이프 안 된 `% & # _ ^` 개수. 예를 들어 한국어 글의 "50%" 는 그 뒤 줄을 주석으로 만듭니다.
  7. 빈 줄 수(블록 수 유지)
  8. 고치려는 블록이 주석·verbatim·서문인 경우
- **느슨한 모드**(오류 고치기 `tex_fix`):
  - 고칠 수 있는 범위는 진단된 줄 주변 ±K 블록과 서문입니다.
  - 변경 수는 작게 하고, 중괄호 짝이 더 나빠지지 않아야 합니다.
  - 진짜 확인은 다음 컴파일입니다. 적용 후 다시 컴파일해 오류가 늘면 알리고 되돌리기를 권합니다.
- **나중에**: 서버가 사본에 적용해 컴파일해 보고 "컴파일 확인됨" 표시를 붙입니다(M7).

### 작업과 프롬프트

- **작업 구분**:
  - 화면에 보이는 모드(`shared/src/api.ts` 의 `AI_MODES`)에 `tex_fix` 를 추가합니다.
  - 서버 내부 작업은 `chat`·`format_check`·`tex_chat`·`tex_fix` 로 나눕니다. tex 문서의 대화는 `tex_chat` 으로 보냅니다.
  - 작업마다 모델·시스템 프롬프트를 설정할 수 있습니다(`config.ts`·`providers.ts` 가 작업 목록을 돕니다).
- **요청 형식**: `AiRequestSchema` 에 `compile?: { diagnostics(≤50), logExcerpt(≤8000자) }` 를 추가합니다.
- **미리 정한 지시 단추**: "학술 문체로 다듬기", "영어 문장 다듬기", "맞춤법", "용어 통일". 모드를 따로 두지 않고 `tex_chat` 에 지시로 보냅니다.
- **프롬프트**(`server/src/ai/prompt.ts`): LaTeX 절을 추가합니다.
  - 입력 형식은 `[번호] (파일:줄) "블록"` 입니다.
  - `find` 는 줄바꿈까지 정확히 씁니다.
  - 수식·라벨·참조·인용 키·명령은 지시 없이는 건드리지 않습니다.
  - 본문의 `% & # _ $` 는 이스케이프합니다.
  - `.bib` 에 없는 `\cite` 키를 지어내지 않습니다.
  - 한국어 학술 문체(평서형 "-다")를 씁니다.
  - `tex_fix` 는 오류 근처를 최소한으로 고칩니다. 패키지·글꼴이 없다는 오류는 제안 없이 설명만 합니다.
- **데모 AI**(`server/src/ai/mock.ts`):
  - 본문 블록에 기존 오타 목록을 적용합니다.
  - `Environment itemise undefined` 로그는 `itemise → itemize` 로 고칩니다(종단 시험용).
- **안내문**: `web/src/editor/coverage.ts` 에 tex 안내를 추가합니다. 무엇을 보내는지, 그리고 수식·키·verbatim·서문은 고치지 않는다는 점을 적습니다.

## 템플릿

- **목록**: 직접 만든 것만 넣습니다(`templates/latex/{ko-article,ko-report,en-article,ko-beamer}/`). 빌드할 때 `web/public/templates/*.zip` 으로 묶습니다.
  - 한국어: XeLaTeX + kotex, 글꼴 명시
  - report: 장·목차·biblatex(biber)
- **라이선스**: CC0 또는 MIT(사용자 결정, **아직 정하지 않음**). 사용자의 논문이 AGPL 문제에 얽히지 않게 합니다.
- **학교 학위논문 양식·로고는 넣지 않습니다**(라이선스·상표). 사용자가 직접 올려 쓸 수 있고, TeX Live 에 들어 있는 클래스는 그대로 됩니다.

## 실험 (구현 전에 먼저, CLAUDE.md 의 "코어를 직접 불러 실험" 원칙)

| 실험 | 재는 것 | 정하는 것 |
| --- | --- | --- |
| E1 실제 TeX | pdfLaTeX+kotex, XeLaTeX+kotex(Noto·나눔), LuaLaTeX+luatexko 로 한국어 표본 컴파일. 처음·반복 시간, `pdffonts` 글꼴 포함, `pdftotext` 한글 대조, 이미지 크기. 오류·경고 로그를 모아 해석기 시험 자료로 씀 | 기본 엔진, 무료·유료 시간 제한, 넣을 묶음 |
| E2 탈출 시험 묶음(`compiler/test/escape/`) | 아래 목록이 모두 막히거나 제한되는지 | CI 에 고정 |
| E3 격리 방식 | bubblewrap 이 컨테이너 안(runc, 필요하면 seccomp 설정 / runsc)에서 동작하는지 | 안쪽층 도구(bubblewrap·nsjail·작업별 컨테이너) |

### 실험 결과 (2026-10-14, 이 환경에서 한 번 해 본 것이며 CI 에서는 돌지 않는다)

이 환경은 4코어·메모리 15GB 의 가상 머신(Ubuntu 24.04, 커널 6.18)이다. TeX Live 는 계획한 연도 스냅숏(`install-tl`)이 아니라 **Ubuntu 패키지의 TeX Live 2023**(`texlive-xetex`·`texlive-luatex`·`texlive-lang-korean`·`texlive-latex-extra` 등, `fonts-noto-cjk`·`fonts-nanum`)으로 했다. 그래서 아래 값은 방향을 정하는 참고값이고, 실제 이미지로 다시 잰다.

**E1 — 한국어 컴파일**(표본: 절 3개, 수식·표·문장 부호가 든 한 쪽 문서와, 그것을 40번 이어 붙인 23쪽 문서. `latexmk -norc`, 깨끗한 폴더에서 처음부터)

| 엔진 · 글꼴 | 1쪽 처음 | 1쪽 반복 | 23쪽 | PDF 크기(1쪽 / 23쪽) | 글꼴 포함 | 한글 대조 |
| --- | --- | --- | --- | --- | --- | --- |
| pdfLaTeX + kotex(기본 Type1 한글 글꼴) | 1.70초 | 1.30초 | 1.66초 | 1,608,139 / 1,650,588 바이트 | 47개 모두 포함 | 4/4 |
| XeLaTeX + kotex, Noto Serif/Sans CJK KR | 2.10초 | 2.14초 | 2.27초(다시 세 번 2.55·2.79·2.93초) | 44,474 / 79,067 | 12개 모두 포함 | 4/4 |
| XeLaTeX + kotex, 나눔명조·나눔고딕 | 2.01초 | 2.23초 | 2.54초 | 52,998 / 87,397 | 12개 모두 포함 | 4/4 |
| LuaLaTeX + luatexko, Noto | **75.23초** | 9.93초 | 9.76초 | 96,422 / 135,761 | 12개 모두 포함 | 4/4 |

- "글꼴 포함"은 `pdffonts` 의 emb 칸, "한글 대조"는 `pdftotext` 결과에 표본의 한글 구절 4개가 그대로 들어 있는지 센 것이다.
- **LuaLaTeX 첫 실행 75초는 글꼴 캐시를 만드는 시간**이다. 설계대로 이미지를 만들 때 `luaotfload-tool -u` 로 미리 만들어야 한다. 캐시가 있어도 XeLaTeX 보다 약 4배 느렸다.
- pdfLaTeX + kotex 는 한 쪽짜리도 PDF 가 1.6MB 였다(한글 Type1 글꼴 조각 47개). 빠르지만 결과물이 크다.
- XeLaTeX + kotex 한 쪽을 그림으로 그려 눈으로 봤다: 한글·수식·표가 바르게 나왔다. 다른 조합은 그림으로 보지 않았다.
- `article` 의 표 제목이 "Table 1" 로 나온다. 한국어 템플릿에서 제목 이름을 한국어로 정해야 한다.
- **정한 것(제안)**: 기본 엔진은 설계대로 XeLaTeX + kotex(Noto). LuaLaTeX 는 제공하되 느리다고 안내한다. 무료 시간 제한은 실제 논문(그림·참고문헌·여러 번 컴파일)으로 다시 재고 정한다. 위 23쪽 문서는 3초 안에 끝났지만 그림과 biber 가 없다.

**E3 — 컨테이너 안의 bubblewrap**(Docker 29.8.2, runc. `--cap-drop ALL`, `no-new-privileges`, 사용자 65534, 읽기 전용 루트, `/tmp` tmpfs. TeX 는 이 기계의 `/usr` 를 읽기 전용으로 붙여 썼다)

| 컨테이너 설정 | bwrap 이 자기 `/proc` 를 붙임 | 결과 |
| --- | --- | --- |
| Docker 기본 seccomp | 예·아니오 | **실패**: "No permissions to create new namespace" |
| seccomp 해제(`unconfined`) | 예 | 실패: `/proc` 를 붙이지 못함 |
| seccomp 해제 | 아니오 | 성공 |
| seccomp 해제 + `systempaths=unconfined` | 예 | 성공 |
| **기본 seccomp + 7개 호출 허용**(`unshare` `setns` `mount` `umount2` `pivot_root` `clone` `clone3`) | 아니오 | **성공** |
| 위 + `systempaths=unconfined` | 예 | 성공 |

- **Docker 기본 seccomp 로는 bubblewrap 이 돌지 않는다.** seccomp 를 통째로 끄는 대신, Docker 기본 프로필(`moby/profiles` 저장소의 `seccomp/default.json`)에 위 7개만 더한 프로필을 쓰고, bwrap 에서 `--proc /proc` 를 빼는 것을 제안한다(TeX 는 `/proc` 없이 컴파일됐다). "격리" 절의 `bwrap` 명령을 이에 맞게 고쳤다(`--proc /proc` 뺌, `/lib`·`/lib64`·`/bin` 심볼릭 링크와 `PATH`·TeX 설정 환경변수 더함). Ubuntu 패키지 TeX 는 `/etc/texmf`·`/var/lib/texmf` 도 읽기 전용으로 붙여야 했다(`install-tl` 설치는 `<texlive>` 한 곳).
- 같은 설정에서 탈출 시험 일부(E2 의 앞부분)를 해 봤다.
  - `\write18{touch …}`: `shell_escape=f` 로 "runsystem … disabled", 파일이 생기지 않음
  - `\openout` 로 `../escaped.txt`: "I can't write on file" 로 멈춤, 파일이 생기지 않음
  - `\openin` 으로 `/etc/passwd`: `openin_any=p` 에서 못 읽음. `openin_any=a` 로 풀어도 bwrap 이 그 파일을 붙이지 않아 못 읽음(두 겹이 따로 막는 것을 확인)
  - 바깥 연결(펄로 1.1.1.1:80): "Network is unreachable"
  - 환경변수: 컨테이너에 넣은 비밀값이 bwrap 안에서 보이지 않고, bwrap 에 지정한 6개와 셸이 넣는 `PWD` 만 보임
- **확인하지 못한 것**: gVisor(`runsc`, 설치하지 않음), 자원 고갈(무한 반복·로그 폭주·메모리·프로세스 수), LuaTeX 의 `os.execute`·`io.open`, biber 원격 자료, ZIP 항목 검사. 그리고 **운영 서버의 커널 설정**: Ubuntu 23.10 이상은 AppArmor 로 권한 없는 사용자 이름공간을 막을 수 있는데(`kernel.apparmor_restrict_unprivileged_userns`), 이 기계에는 AppArmor 가 없어 그 경우를 시험하지 못했다. 막혀 있으면 nsjail 이나 작업별 컨테이너로 가야 한다.

E2 목록:
- 파일 읽기·쓰기 시도: `\input{/etc/passwd}`, `\openout` 로 `../` 쓰기, `\write18`
- LuaTeX: `os.execute`·`io.open('/etc/…')`·소켓
- 외부 연결: biber 원격 자료
- 설정 파일: 프로젝트 `latexmkrc`
- 자원 고갈: 무한 매크로 반복, 로그 폭주, PDF 크기 폭증, 메모리 증가, 프로세스 생성
- ZIP: `..`·절대 경로·심볼릭 링크 항목, zip 폭탄
- 파일 이름: 한글·공백·아주 긴 이름
- 경계 넘기: 다른 작업 폴더 읽기, 일꾼 환경변수 읽기

## 시험

- **단위 시험**:
  - `shared/src/tex/{chunk,check,log}.test.ts`: 검증 규칙마다 끄면 실패하는지 확인합니다.
  - 서버:
    - tex 정책 시험(`convert.test.ts`)
    - `MockCompilerClient` 로 한도·대기열·동시 1개·사용자별 해시 대조 시험
  - 웹:
    - `texProject.test.ts`(fake-indexeddb, DB 1→2 올리기, ZIP 안전성)
    - tex 모델 적용·지문 시험
- **종단 시험**:
  - `e2e/tex.spec.ts` 는 `COMPILER=mock` 으로 돌립니다: 템플릿 → 편집 → 컴파일 → PDF → 오류 눌러 이동 → 데모 AI 고치기 → 적용 → 다시 컴파일
  - `e2e/tex-real.spec.ts` 는 `REQUIRE_TEXLIVE=1` 일 때만 실제 일꾼으로 돌립니다(`REQUIRE_SOFFICE` 와 같은 방식).
  - 편집기와 얽힌 동작은 화면 캡처로 눈으로 확인합니다.
- **CI**:
  - 새 `latex` 작업은 `compiler/**`·`shared/src/tex/**`·tex 엔진 파일이 바뀔 때와 야간에만 돌립니다. 고정 이미지를 받아 탈출 시험과 `tex-real` 을 실행합니다.
  - 이미지는 `compiler/**` 가 바뀔 때만 빌드합니다.
  - 러너 디스크 용량을 측정해 둡니다.

## 함께 고칠 문서

- `docs/SPEC.md`: 지원 형식 표
- `README.md`: 지원 형식, "서버에 문서를 저장하지 않습니다" 문구
- `docs/AI.md`: tex 작업, 보내는 것, 검증 규칙
- `docs/DEPLOY.md`: 컴파일 서비스, 환경변수 `COMPILER_*`, 알려진 한계(측정값)
- `docs/DESIGN.md`: tex 화면 배치
- `THIRD_PARTY_NOTICES.md`: CodeMirror, fflate, TeX Live·글꼴(이미지 안), bubblewrap, gVisor
- `CLAUDE.md`: `compiler/`, `REQUIRE_TEXLIVE`
- `web/src/editor/coverage.ts` 와 그 문구를 확인하는 종단 시험
- `.env.example`

## 확인하지 못한 것 (이 문서를 쓸 때)

- 실제 이미지 크기(E1 은 Ubuntu 패키지로 했고 설치한 TeX·글꼴 패키지의 설치 크기 합이 약 548MB(dpkg 기준) 였다. `install-tl` 이미지는 재지 않았다)
- 그림·참고문헌이 든 실제 논문의 컴파일 시간(E1 은 그림·biber 없는 표본으로만 쟀다)
- AppArmor 가 사용자 이름공간을 막는 운영 서버에서 bubblewrap 이 도는지, gVisor 위에서 도는지(E3 은 AppArmor 없는 가상 머신의 Docker 에서만 했다)
- CodeMirror 6 의 한글 입력기 동작(특히 휴대폰)
- 브라우저용 엔진(SwiftLaTeX, BusyTeX 의 TeX Live 2026 포크)은 서버 컴파일로 정해서 평가하지 않았습니다.
