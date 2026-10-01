# 제3자 소프트웨어 고지

이 저장소의 코드는 [AGPL-3.0-only](LICENSE)로 공개합니다. 이 문서는 AllDoc이 **가져다 쓰는 다른 소프트웨어**와 그 라이선스를 정리한 것입니다.
**이 문서는 법률 자문이 아닙니다.** 공개 운영(특히 상업적 운영) 전에는 아래 "먼저 확인할 것"을 변호사와 함께 검토하세요.

배포물에 들어가는 의존성의 라이선스는 `npm run check:licenses` 로 언제든 다시 뽑을 수 있고, 허용 목록에 없는 라이선스가 새로 생기면 CI가 실패합니다.

## 먼저 확인할 것: SuperDoc의 독점 DOCX 엔진

Word(DOCX) 편집은 [SuperDoc](https://www.superdoc.dev) `superdoc@2.19.1`을 씁니다. 그런데 SuperDoc 2는 `@superdoc/docx-engine@0.18.0`이라는
**별도 패키지에 의존**하고, 이 패키지는 오픈소스가 아니라 **독점 라이선스**입니다.

| 부품 | 라이선스 | 비고 |
| --- | --- | --- |
| `superdoc` 2.19.1 | AGPL-3.0, 또는 SuperDoc과의 별도 상용 계약 | 이 저장소를 AGPL-3.0-only로 공개하는 이유 중 하나입니다. |
| `@superdoc/docx-engine` 0.18.0 | **SuperDoc DOCX Engine Proprietary License** (버전 2026-07-14) | 이 저장소의 AGPL-3.0 **적용 대상이 아닙니다.** 설치만 해도 이 라이선스에 동의한 것으로 봅니다(라이선스 본문 "Acceptance by use"). |

라이선스 전문은 설치된 `node_modules/@superdoc/docx-engine/DOCX-ENGINE-LICENSE.md` 와 https://docs.superdoc.dev/resources/docx-engine-license 에 있습니다.
SuperDoc의 문의처는 패키지의 `NOTICE.md`에 `legal@superdoc.dev`로 적혀 있습니다. 읽고 확인한 요지는 다음과 같습니다(요약이므로 전문을 직접 읽으세요).

- 상업 계약이 없으면 "SuperDoc의 의존성으로서, SuperDoc의 AGPL 코드에 허용되는 범위의 평가·개발·시험 등 사용"만 허락합니다.
  운영(production)·상업적 사용은 SuperDoc과의 별도 계약이 허락하는 범위에서 가능하다고 적혀 있습니다.
  **AGPL을 지키며 공개 서비스로 운영하는 것이 이 "허용되는 범위"에 드는지는 이 문서가 판단하지 않습니다. SuperDoc과 변호사에게 확인하세요.**
- 재배포·미러링·단독 패키지로 제공 금지, 역공학·난독화 해제 금지, 표시(고지) 제거 금지.
- 경쟁 제품(문서 편집기, 문서 변환·내보내기 엔진 등 "SuperDoc 또는 DOCX 엔진 자료와 경쟁하거나 실질적으로 유사한 제품")을 만들거나 개선하거나 돕는 데 쓰는 것 금지.
  AllDoc은 문서 편집기이므로 이 조항에 해당하지 않는지 확인이 필요합니다.
- 엔진 자료를 AI 시스템에 올려 구조를 파악하거나 대체품을 만드는 데 쓰는 것 금지. 이 앱의 AI 기능은 사용자의 **문서 내용**을 AI 서비스로 보내는 것이며 엔진 자료를 보내지 않습니다.
  개발 방침도 같습니다: 엔진은 SuperDoc의 공개 API(설정, 문서 API)로만 호출하고, 엔진의 내부 구현을 분석하거나 AI 도구에 올리지 않습니다.
- 이 엔진은 사용자의 브라우저로 내려가는 빌드 결과물(`DocxEngine-*.js`, `docx-engine.es-*.js`)에 포함됩니다.

### 선택지

1. SuperDoc과 상용 계약(또는 서면 확인)을 맺는다.
2. 변호사 검토 후 AGPL 준수 범위의 사용으로 본다.
3. **Word(DOCX) 지원을 끄고 배포한다.** 빌드할 때 `VITE_DISABLE_DOCX=1` 을 지정하면 SuperDoc과 엔진이 결과물에 들어가지 않고, DOCX 파일은 "이 서버에서는 지원하지 않는다"고 안내합니다
   (자세한 방법: [docs/DEPLOY.md](docs/DEPLOY.md)). 단, `npm install` 단계에서 패키지는 내려받아지므로, 설치 자체가 문제라면 `web/package.json`에서 `superdoc`을 빼야 합니다.

## 브라우저로 내려가는 부품 (런타임)

| 부품 | 버전 | 라이선스 | 쓰임 |
| --- | --- | --- | --- |
| [rhwp](https://github.com/edwardkim/rhwp) 편집기(rhwp-studio) | v0.8.6 (커밋 `f1f9c6ae`) | MIT | HWP·HWPX 편집 화면. 정해 둔 커밋의 소스를 빌드 때 받아 **우리 서버에서 직접 제공**합니다(제3자 사이트로 문서가 넘어가지 않도록). |
| `@rhwp/core` | 0.8.6 | MIT | HWP·HWPX를 읽고 고치는 WASM(AI·서식 점검·기준 문서) |
| `@rhwp/editor` | 0.8.6 | MIT | 편집기 화면과 앱을 잇는 작은 연결 코드 |
| [pdf.js](https://mozilla.github.io/pdf.js/) `pdfjs-dist` | 6.3.289 | Apache-2.0 | PDF 보기 |
| `superdoc` | 2.19.1 | AGPL-3.0 (위 설명 참고) | Word(DOCX) 편집 화면 |
| `@superdoc/docx-engine` | 0.18.0 | 독점 (위 설명 참고) | SuperDoc의 DOCX 처리 엔진 |
| React, React DOM | 19.3.0 | MIT | 화면 |
| React Router | 7.18.4 | MIT | 화면 이동 |
| zustand | 5.0.15 | MIT | 화면 상태 |
| idb | 8.0.3 | ISC | 브라우저 저장소(IndexedDB) |
| marked | 18.0.14 | MIT | 마크다운 미리보기 |
| DOMPurify | 3.4.16 | MPL-2.0 또는 Apache-2.0 | 마크다운 미리보기에서 위험한 코드 걸러내기 |
| zod | 4.6.5 | MIT | 요청·응답 검증(브라우저와 서버 공용) |
| Noto Sans KR (`@fontsource-variable/noto-sans-kr`) | 5.3.0 | SIL OFL 1.1 | 화면 글꼴 |

### 한글 편집기에 함께 들어가는 글꼴과 라이선스

rhwp-studio 빌드는 웹 글꼴(Pretendard, 나눔, Noto, 고운, Spoqa 등)을 함께 담습니다. 글꼴별 라이선스와 출처는 빌드 결과에 함께 들어 있는 다음 파일을 따릅니다.

- `/rhwp-studio/LICENSE` (rhwp, MIT)
- `/rhwp-studio/THIRD_PARTY_LICENSES.md` (rhwp가 쓰는 라이브러리·글꼴 고지)
- `/rhwp-studio/FONTS.md` (글꼴 목록과 출처)

**한컴(함초롬바탕·함초롬돋움 등)과 Microsoft(맑은 고딕, Arial, Calibri 등)의 저작권 있는 글꼴은 포함하지 않습니다.**
그런 글꼴을 쓰는 문서는 대체 글꼴로 표시되어 줄바꿈·쪽 나눔이 원본과 다를 수 있습니다. 글꼴 이름은 파일에 그대로 남아, 그 글꼴이 설치된 컴퓨터에서 열면 원래대로 보입니다.

## 서버 (Node.js)

| 부품 | 버전 | 라이선스 | 쓰임 |
| --- | --- | --- | --- |
| Hono | 4.13.12 | MIT | 웹 서버 |
| `@hono/node-server` | 2.1.3 | MIT | Node.js 연결 |
| `@anthropic-ai/sdk` | 0.131.0 | MIT | Claude 연결(공식 SDK) |
| SQLite | Node.js 내장(`node:sqlite`) | Public Domain / Node.js (MIT) | 하루 사용 횟수 저장 |

서버는 esbuild로 `dist/main.js` 하나로 묶으므로, 위 부품의 코드가 그 파일 안에 들어갑니다.

## 개발에만 쓰고 배포하지 않는 도구

TypeScript, Vite, Vitest, Playwright, esbuild, tsx, jsdom, fake-indexeddb 등. 결과물에 포함되지 않습니다.

## 다시 확인하는 방법

```bash
npm run check:licenses            # 배포물 의존성의 라이선스 분포와 주의 대상
npm ls --omit=dev --all           # 의존성 전체 목록
```

## 상표

"한글", "한컴", "HWP", "HWPX"는 주식회사 한글과컴퓨터의 등록 상표입니다. "Word", "Microsoft"는 Microsoft Corporation의 상표입니다.
"Claude"는 Anthropic, PBC의 상표입니다. 이 프로젝트는 위 회사들과 관련이 없으며, 각 파일 형식의 호환성은 공개된 형식 설명과 위 오픈소스 부품에 기댑니다.
