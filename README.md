# AllDoc (임시 이름)

한글(HWP)·Word 등 여러 문서를 **브라우저 한 곳에서 편집**하고, AI가 **서식과 문장 변경을 제안**하는 웹 편집기입니다.
AI는 문서를 마음대로 고치지 않습니다. "변경 내역"에 제안을 올리면, 사용자가 **적용한 것만** 문서에 반영됩니다.

> 상태: 개발 중. 확정한 제품 범위는 [`docs/SPEC.md`](docs/SPEC.md)에 있습니다.
> "AllDoc"은 임시 이름입니다. 비슷한 이름의 앱이 이미 있어, 공개 운영 전에 상표와 도메인을 확인해야 합니다.

## 지원 파일

| 형식 | 열기·편집 | 저장 | 사용한 부품 |
| --- | --- | --- | --- |
| HWP 5.0, HWPX | 가능 | 같은 형식 | [rhwp](https://github.com/edwardkim/rhwp) (MIT) |
| DOCX | 가능 | DOCX | [SuperDoc](https://www.superdoc.dev) (AGPL-3.0) |
| PDF | 보기 | (각 형식에서 PDF로 내보내기) | pdf.js (Apache-2.0) |
| TXT, Markdown | 가능 | 같은 형식 | 자체 구현 |

각 형식은 **원본 형식 그대로** 저장합니다. 원본은 덮어쓰지 않고 새 파일로 내려받습니다.

## 구조

```
shared/   웹·서버가 함께 쓰는 타입과 검증 스키마 (zod)
web/      브라우저 앱 (React + TypeScript + Vite)
server/   로그인, 하루 사용 한도, AI 중계, 정적 파일 제공 (Node.js + Hono)
e2e/      Playwright 종단 시험
docs/     명세, 디자인, AI 연결 방법, 배포 방법
```

- 문서는 **브라우저에만** 저장됩니다(IndexedDB). 서버에는 문서를 저장하지 않습니다.
- 서버는 AI 사용 횟수 관리(로그인)와 AI 요청 중계만 합니다. **AI 키는 서버에만** 있고 브라우저로 내려가지 않습니다.
- AI를 쓸 때만 문서 내용이 AI 서비스로 전송됩니다. 처음 쓸 때 동의를 받고, 설정에서 끌 수 있습니다.

## 개발 환경에서 실행

필요한 것: Node.js 22.13 이상.

```bash
npm install
cp .env.example .env     # 값을 채웁니다. 처음에는 AUTH_MODE=dev, AI_PROVIDER=mock 으로 시험할 수 있습니다.
npm run dev:server       # http://localhost:8787
npm run dev:web          # http://localhost:5173 (/api 는 서버로 전달)
```

검사와 시험:

```bash
npm run typecheck
npm test                 # 단위 시험
npm run build
npm run test:e2e         # 종단 시험 (Playwright, 처음에는 npx playwright install chromium)
```

## 라이선스

[AGPL-3.0-only](LICENSE). 이 서비스를 인터넷으로 제공하면, 이용자가 요청할 때 소스 코드를 제공해야 합니다.
사용한 부품의 라이선스는 `THIRD_PARTY_NOTICES.md`에 정리합니다. 법적 판단이 필요하면 변호사와 확인하세요.

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표이며, 이 프로젝트는 한글과컴퓨터와 관련이 없습니다.
