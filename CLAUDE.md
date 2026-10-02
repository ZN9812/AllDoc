# AllDoc 작업 안내

한글(HWP·HWPX)·Word(DOCX)·TXT/MD 를 브라우저에서 편집하고 PDF 는 보기만 하는 웹 편집기다. AI 는 서식·문장 변경을 **제안만** 하고, 사용자가 적용한 것만 문서에 반영된다.
"AllDoc"은 임시 이름이다. 라이선스는 AGPL-3.0. 제품 명세 `docs/SPEC.md`, 화면 규칙 `docs/DESIGN.md`, AI 연결 `docs/AI.md`, 배포와 **알려진 한계(확인한 수치 포함)** `docs/DEPLOY.md`, 한글 캡션 조사 `docs/CAPTION.md`.

## 작업 규칙
- 사용자에게 보이는 글은 모두 한국어로 쓴다: 답변, 화면 문구, 문서, 오류 메시지, 시험 이름, 커밋 메시지.
- 아첨과 이모지를 쓰지 않는다. 말하기 전에 사실부터 확인한다. 보고는 핵심 위주로 짧게 하고, 끝나면 이어서 할 만한 일을 제안한다.
- **확인한 것과 하지 못한 것을 구분해서 쓴다.** 해 보지 않은 것을 했다고 쓰지 않고, 수치는 실제로 센 값만 쓴다. 이 환경에서만 한 번 해 본 확인은 "CI 에서는 돌지 않는다"고 적는다.
- PR 은 사용자가 요청할 때만 만든다. 푸시는 사용자가 정한 브랜치에만 한다(지금까지는 `claude/web-document-editor-design-4kd6km`). 저장소 공개 범위(Private 전환)는 사용자가 직접 한다.
- 커밋 메시지: 첫 줄에 한 일, 본문에 이유·확인한 것·한계를 적는다.

## 구조
```
shared/  웹·서버 공용 타입과 zod 스키마 (문단 위치 CellPlace·AreaPlace, 변경 Op, textGuard)
web/     React 19 + Vite + vitest. 문서 엔진 web/src/engines/{hwp,docx,...}, 화면 web/src/editor
server/  Hono. 로그인·하루 한도·AI 중계. AI 프롬프트와 데모 AI 는 server/src/ai/{prompt,mock}.ts
e2e/     Playwright. 빌드한 서버(포트 8799, AUTH_MODE=dev, AI_PROVIDER=mock)에 붙는다
```
- 한글은 rhwp(`@rhwp/core` 코어 + 자체 호스팅한 편집기 rhwp-studio), Word 는 SuperDoc 이다. SuperDoc 의 독점 DOCX 엔진 라이선스는 README·`THIRD_PARTY_NOTICES.md` 를 보고, `VITE_DISABLE_DOCX=1` 로 Word 지원을 끌 수 있다.

## 명령어
```bash
npm ci
npm run typecheck && npm test            # 단위 시험(shared·web·server)
npm run check                            # 타입 검사 + 단위 시험 + 라이선스
RHWP_STUDIO_STRICT=1 npm run build       # 처음 한 번 GitHub 에서 rhwp-studio 와 예제 한글 문서 12개를 .cache 에 받는다
REQUIRE_HWP_SAMPLES=1 npm test -w web -- src/engines/hwp/corpus.test.ts   # 예제 문서 대조(빌드 뒤)
npx playwright test e2e/<파일> --project=desktop                          # 종단 시험(빌드 뒤)
```
- 종단 시험은 8799 포트에 남은 옛 서버를 재사용하므로, 다시 빌드한 뒤에는 `pkill -f "[s]erver/dist/main.js"` 로 끄고 돌린다. `PW_CHROMIUM_PATH` 로 크로미움을 지정할 수 있다. `REQUIRE_SOFFICE=1`(LibreOffice 필수)·`REQUIRE_HWP_SAMPLES=1` 이면 건너뛰지 않고 실패한다.
- **큰 변경을 푸시하기 전 전체 검증**(CI 와 같다. 약 10분): typecheck → `npm test` → `RHWP_STUDIO_STRICT=1 npm run build` → corpus 시험 → `npm run check:licenses` → `REQUIRE_SOFFICE=1 REQUIRE_HWP_SAMPLES=1 npx playwright test` →
  `VITE_DISABLE_DOCX=1 npm run build` 후 `VITE_DISABLE_DOCX=1 npx playwright test e2e/docx-disabled.spec.ts e2e/home.spec.ts --project=desktop` → 일반 빌드로 되돌리기. 검증하는 동안에는 소스와 시험을 고치지 않는다(빌드가 섞인다).
- 푸시 뒤에는 CI(`.github/workflows/ci.yml`: test, no-docx, docker)가 통과하는지 확인한다.

## 한글(HWP) 엔진 메모 — `web/src/engines/hwp/`
- `model.ts` 의 `HwpModel` 은 문서를 "문단 칸"으로 문서 순서대로 늘어놓고, 그 칸 번호가 AI 가 보는 문단 번호다. 칸 종류는 본문·표 칸·글상자·캡션·머리말·꼬리말·각주·미주다(파일 맨 위 주석에 순서 규칙이 있다).
  변경(`replaceText`·`setCharStyle`·`setParaStyle`)은 문단 글의 지문(`guard`)이 맞을 때만 적용하고, 한 묶음에서 하나라도 실패하면 모두 되돌린다(`applyAtomic`).
- 코어는 글자를 코드 포인트로 센다(자바스크립트 문자열 위치와 다름). 표 칸·글상자·그림 캡션은 경로 함수(`*InCellByPath`), 표 캡션은 칸 번호 65534 를 쓰는 평평한 함수로 읽고 고친다. 문단 서식은 본문에 바로 놓인 개체만 된다.
- 코어 함정: `getControls()` 는 구역이 둘 이상인 문서에서 표 칸·글상자 안 컨트롤을 빠뜨린다(믿지 않는다). `getFootnoteInfo` 는 글 속 탭 때문에 깨진 JSON 을 줄 수 있다. 캡션의 자동 번호는 글 속 공백 한 글자로만 보이고 캐럿·선택 위치는 번호 글자만큼 어긋난다(`docs/CAPTION.md`).
  `issue2063_huge_cellbreak_table.hwp` 는 코어가 열지 못하고, HWP 3.0 은 지원하지 않는다.
- 편집기(rhwp-studio)는 별도 화면(iframe)이다. `web/scripts/build-rhwp-studio.mjs` 가 빌드 때 패치를 끼워 `window.__alldocFocusCell` 을 노출하고, "문서에서 보기"가 그것을 쓴다.
- 시험은 진짜 코어를 Node 에서 불러(`testing.ts`: `loadNodeCore`, `openSample`·`openTableSample`·`openAreaSample`·`openBoxSample`·`openCaptionSample`) 문서를 만들어 내보냈다 다시 열어 쓴다.
- **새 기능을 넣는 순서**: ① 코어를 직접 불러 실험하고(소스만 읽고 믿지 않는다) ② 모델을 만들고 ③ 만든 문서로 단위 시험, ④ `corpus.test.ts` 에서 예제 문서를 코어를 직접 걸으며 센 것과 맞추고, ⑤ 앱 종단 시험을 하고(편집기와 얽힌 동작은 화면 캡처로 눈으로 본다), ⑥ 문서·안내문·프롬프트를 고치고, ⑦ 전체 검증 후 푸시한다.
  새 시험은 고친 코드를 일부러 끄면 실패하는지 확인한다. 예제 900개 전체 확인은 rhwp 저장소를 받아 `RHWP_SAMPLES_DIR` 로 가리켜 돌린다(일회성).

## 지원 범위를 바꿀 때 함께 고칠 곳
- 문서: `docs/DEPLOY.md`("알려진 한계"), `README.md`, `docs/AI.md`, `docs/DESIGN.md`. 화면 안내문 `web/src/editor/coverage.ts` — 그 문구를 확인하는 종단 시험(`grep -l coverage-note e2e/*.ts`)도 함께 고친다.
- AI 에게 알리는 규칙: `server/src/ai/prompt.ts` 와 데모 AI `mock.ts`(각각의 시험 포함). 서식 규칙은 사용자가 그곳(표·머리말·꼬리말·각주·미주·글상자·캡션)을 언급했을 때만 적용하고, 맞춤법·말투 교정은 모두 적용한다.
- 카드 위치 문구: `shared/src/style.ts`(`areaLabel`)와 `web/src/ai/guards.ts`.

## 아직 확인하지 못한 것
진짜 Claude 호출(API 키 없이 가짜 클라이언트로만 시험), 구글 로그인, 한컴오피스·Microsoft Word 에서 고친 파일 열기, Windows 에서 한글 편집기 빌드(안 되면 WSL2), 실제 휴대폰.
