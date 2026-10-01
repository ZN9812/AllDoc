# AllDoc (임시 이름)

한글(HWP)·Word 등 여러 문서를 **브라우저 한 곳에서 편집**하고, AI가 **서식과 문장 변경을 제안**하는 웹 편집기입니다.
AI는 문서를 마음대로 고치지 않습니다. "변경 내역"에 제안을 올리면, 사용자가 **적용한 것만** 문서에 반영됩니다.

> "AllDoc"은 임시 이름입니다. 비슷한 이름의 앱이 이미 있어, 공개 운영 전에 상표와 도메인을 확인해야 합니다.
> 확정한 제품 범위는 [`docs/SPEC.md`](docs/SPEC.md)에 있습니다.

> **공개 운영 전에 꼭 확인하세요.** Word(DOCX) 편집에 쓰는 SuperDoc은 오픈소스(AGPL-3.0)인데, 그 DOCX 엔진 부품(`@superdoc/docx-engine`)은 **독점 라이선스**입니다.
> 운영 형태에 맞는지 SuperDoc·변호사에게 확인하거나, `VITE_DISABLE_DOCX=1`로 빌드해 Word 지원을 끄고 배포할 수 있습니다.
> 자세한 내용은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## 지원 파일

| 형식 | 열기·편집 | 저장 | 사용한 부품 |
| --- | --- | --- | --- |
| HWP 5.0, HWPX | 가능 | 같은 형식(서로 변환해 내려받기 가능) | [rhwp](https://github.com/edwardkim/rhwp) (MIT) |
| DOCX | 가능 | DOCX | [SuperDoc](https://www.superdoc.dev) (AGPL-3.0, 독점 DOCX 엔진 포함) |
| PDF | 보기 | (한글 문서는 인쇄 창에서 PDF로 저장) | pdf.js (Apache-2.0) |
| TXT, Markdown | 가능 | 같은 형식 | 자체 구현 |

각 형식은 **원본 형식 그대로** 저장합니다. 원본은 덮어쓰지 않고 `<이름>_수정본.<확장자>`로 내려받습니다.
제외: Excel, PowerPoint, 구형 .doc, HWP 3.x.

## 할 수 있는 일

- 파일을 올려 바로 고칩니다. 문서는 **이 브라우저에만** 저장됩니다(IndexedDB). 서버에는 문서를 저장하지 않습니다.
- **서식 점검**(로그인 없이, AI 없이 브라우저 안에서): 같은 역할의 문단(번호 항목, 본문 등)끼리 글꼴·크기가 다른 곳 찾기, **기준 문서**(양식 파일)에 맞추기. 한글·Word·글 문서 어느 것을 기준으로 삼아도 됩니다.
- **AI 대화·내 규칙**(로그인 필요, 하루 한도): 맞춤법, 말투, "본문은 맑은 고딕 11pt, 줄 간격 160%" 같은 규칙에 맞춘 변경을 제안받습니다.
- 모든 제안은 카드로 올라오고, 항목마다 적용·취소·되돌리기를 고릅니다. 카드에 마우스를 올리면 문서에서 그 곳이 표시되고(한글 제외), "문서에서 보기"로 그 곳으로 이동합니다.
- 야간 모드, 휴대폰 화면(문서 전체 폭 + 아래에서 올라오는 탭 창).

## 구조

```
shared/   웹·서버가 함께 쓰는 타입과 검증 스키마 (zod)
web/      브라우저 앱 (React + TypeScript + Vite)
server/   로그인, 하루 사용 한도, AI 중계, 정적 파일 제공 (Node.js + Hono)
e2e/      Playwright 종단 시험
docs/     명세, 디자인, AI 연결 방법, 배포 방법
```

- 서버는 AI 사용 횟수 관리(구글 로그인)와 AI 요청 중계만 합니다. **AI 키는 서버에만** 있고 브라우저로 내려가지 않습니다.
- AI를 쓸 때만 문서의 글이 AI 서비스로 전송됩니다. 처음 쓸 때 동의를 받고, 설정에서 끌 수 있습니다.
- AI 연결부는 바꿔 끼울 수 있습니다(첫 연결은 Claude). 작업별 모델·시스템 프롬프트·주소는 설정 파일로 바꿉니다 → [`docs/AI.md`](docs/AI.md)

## 문서

| 문서 | 내용 |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | 확정한 제품 명세 |
| [`docs/DESIGN.md`](docs/DESIGN.md) | 화면 구성, 색, 동작 규칙 |
| [`docs/AI.md`](docs/AI.md) | AI 설정, 다른 AI 붙이기, 사용 횟수와 비용 |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Docker 배포, 구글 로그인 설정, 공개 전 점검표, 알려진 한계 |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | 가져다 쓴 소프트웨어와 라이선스 |

## 처음 한 번 실행해 보기

필요한 것: Node.js 22.13 이상, git(처음 한 번 한글 편집기 소스를 받습니다. GitHub에 나갈 수 있어야 합니다).

```bash
npm install
cp .env.example .env     # 복사한 .env 에서 AUTH_MODE=dev, AI_PROVIDER=mock 두 줄만 고치면 됩니다(Windows 명령 프롬프트는 copy).
npm run build            # 웹·서버·한글 편집기를 만듭니다(처음에는 몇 분 걸립니다).
npm start                # 브라우저로 http://localhost:8787 을 여세요.
```

- `AUTH_MODE=dev`는 가짜 로그인, `AI_PROVIDER=mock`은 실제 AI 없이 정해진 예시 제안만 돌려주는 데모입니다. 진짜 Claude를 쓰려면 [`docs/AI.md`](docs/AI.md).
- 서버는 `.env`를 **개발·시험용으로만** 자동으로 읽습니다. 운영(`NODE_ENV=production`)에서는 읽지 않고, 명령에서 준 환경 변수(`AUTH_MODE=none npm start` 등)가 `.env`보다 앞섭니다.

코드를 고치며 개발할 때는 서버와 웹을 따로 띄웁니다(같은 `.env`를 씁니다).

```bash
npm run dev:server       # http://localhost:8787
npm run dev:web          # http://localhost:5173 (/api 는 서버로 전달)
```

`npm run dev:web`은 처음 실행할 때 한글 편집기(rhwp-studio)를 받아 빌드합니다(실패하면 경고만 하고 HWP를 뺀 나머지는 쓸 수 있습니다).

검사와 시험:

```bash
npm run check            # 타입 검사 + 단위 시험 + 라이선스 점검
npm run test:e2e         # 빌드 후 종단 시험(데스크톱·휴대폰). 처음에는 npx playwright install chromium
```

Docker로 띄우려면 [`docs/DEPLOY.md`](docs/DEPLOY.md)를 보세요.

## 시험으로 확인한 것과 확인하지 못한 것

확인한 것(자동 시험): 문서를 열고·고치고·저장·내려받기(HWP, HWPX, DOCX, PDF, TXT, MD), 서식 점검·기준 문서·내 규칙, 제안의 적용·취소·되돌리기와 오래된 제안 거절,
로그인(개발용)·하루 한도·AI 요청 처리(가짜 AI), 야간 모드, 휴대폰 화면(Chromium 에뮬레이션), Docker 이미지로 띄워 같은 종단 시험.
그리고 두 가지는 우리가 직접 만들지 않은 문서로 확인했습니다.

- **DOCX를 LibreOffice로 다시 열기**: LibreOffice가 만든 DOCX를 열어 고치고, 내려받은 파일을 제3자 프로그램인 LibreOffice로 다시 열어 고친 두 줄 말고는 글이 같고 PDF로도 변환되는지 봅니다(`e2e/interop.spec.ts`. LibreOffice가 없으면 건너뛰고, CI는 설치해서 돌립니다).
- **실제 한글 문서 12개**: rhwp 저장소가 예제로 두는 HWP·HWPX로 열기·서식 제안 적용·내보내기·다시 읽기·되돌리기를 시험했습니다(`web/src/engines/hwp/corpus.test.ts`). 글이 사라지거나 달라진 곳은 없었습니다.

확인하지 못한 것(운영 전에 직접 확인하세요):

- **진짜 Claude 호출**: API 키 없이 개발해서, AI 연결부는 가짜 클라이언트로만 시험했습니다.
- **구글 로그인**: 실제 구글 계정·도메인으로 돌려 보지 못했습니다(개발용 로그인으로만 시험).
- **한컴오피스·Microsoft Word에서 다시 열기**: 내려받은 파일을 이 두 프로그램에서 열어 보지는 못했습니다. HWP·HWPX는 이 환경의 LibreOffice(24.2)가 열지 못해서, 같은 rhwp가 다시 읽은 결과로만 확인했습니다. 한글 프로그램이 같게 연다는 뜻은 아닙니다.
- **실제 휴대폰**: 터치·한글 입력기·가상 키보드.
- **복잡한 실제 업무 문서**: 위 예제 문서는 rhwp 쪽이 고른 것이고, DOCX 시험 문서는 단순한 것입니다. 표·그림·머리말이 많은 실제 업무 문서에서의 호환은 사례를 모아 확인해야 합니다. 특히 표 위주의 한글 양식은 본문 문단이 거의 없어, AI와 서식 점검이 읽을 글이 적습니다([알려진 한계](docs/DEPLOY.md#알려진-한계)).

## 라이선스

[AGPL-3.0-only](LICENSE). 이 서비스를 인터넷으로 제공하면, 이용자가 요청할 때 소스 코드를 제공해야 합니다.
가져다 쓴 부품의 라이선스는 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 정리했습니다(`npm run check:licenses`로 다시 뽑을 수 있습니다). 법적 판단이 필요하면 변호사와 확인하세요.

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 이 프로젝트는 한글과컴퓨터와 관련이 없습니다.
