# 한글 캡션(그림·표) 읽기·고치기: 조사 메모 (진행 중, 코드는 아직 없음)

AI 가 한글(HWP·HWPX) 문서의 **그림 캡션과 표 캡션** 글도 읽고 고치게 하려는 작업의 조사 결과입니다. 구현은 시작하지 않았고
(저장소 코드는 글상자 지원까지가 전부입니다. 마지막 커밋 `8be0a66`), 이어서 할 사람이 같은 조사를 되풀이하지 않도록 확인한 것만 적습니다.
소스를 읽어서 안 것과 코어를 직접 불러 실험해서 확인한 것을 구분해 적었습니다.

## 지금 앱이 하는 일

- 글 캡션이 달린 그림은 코어의 경로 함수로는 글상자처럼 문단이 읽혀서, 글상자로 세지 않도록 `HwpModel.isShapeControl`(`web/src/engines/hwp/model.ts`)이
  개체를 복사 칸에 복사해 코어가 붙이는 갈래 이름("[도형]"/"[그림]")으로 가려냅니다. 캡션 글 자체는 읽지 않습니다.
- 표 캡션도 읽지 않습니다(표 칸만 읽음). `box.test.ts` 가 "캡션이 달린 그림·표는 글상자로 세지 않고 캡션을 읽지 않는다"를 지킵니다.
- 화면 안내문(`web/src/editor/coverage.ts`)과 `docs/DEPLOY.md`, `README.md` 에 "그림·도형의 캡션은 AI가 읽지 못해요"라고 적혀 있습니다.
  캡션을 지원하면 이 문구들과 `e2e/hwp.spec.ts` 의 안내문 확인(169행 부근)을 함께 고쳐야 합니다.
- 예제(rhwp 저장소 샘플 900개)에서 글 캡션이 달린 그림은 70개입니다(본문 문단에 놓인 것 51, 표 칸·글상자 안 19, 24개 문서). 표 캡션은 세어 보지 않았습니다.

## 코어(rhwp 0.8.6)가 캡션에 닿는 길 — 소스(`edwardkim/rhwp` v0.8.6)에서 확인

| 대상 | 경로 함수(`*InCellByPath`) | 평평한 함수(`*InCell`, 본문 문단의 컨트롤만) |
| --- | --- | --- |
| 그림 캡션 | 됨. 경로 한 단계 = `{controlIndex: 그림, cellIndex: 0, cellParaIndex}`, 어느 깊이든 | 됨. `(구역, 본문 문단, 그림 컨트롤, 칸 번호, 캡션 문단)` |
| 표 캡션 | **안 됨**(칸 번호 65534 를 칸으로 읽어 "셀 범위 초과") | 됨. **칸 번호에 65534**(`TABLE_CAPTION_CELL_SENTINEL`)를 넣는다. 표가 본문 문단에 바로 놓였을 때만 |
| 사각형 등 도형·묶음 개체의 캡션 | 안 됨(글상자 글만) | 안 됨(글상자 글만) |

- 위 표의 근거: `src/document_core/queries/cursor_nav.rs`(`resolve_paragraph_by_path`), `src/document_core/commands/text_editing.rs`
  (`get_cell_paragraph_ref/mut`, `get_cell_paragraph_count_native`). 표 안·글상자 안에 놓인 표의 캡션과, 도형·묶음 개체의 캡션은 코어에 닿는 길이 없습니다.
- 글 읽기·삽입·삭제와 글자 서식·문단 서식 읽기·쓰기는 소스상 평평한 함수가 모두 같은 `get_cell_paragraph_ref/mut` 를 거쳐 캡션을 지원합니다(아래 실험은 글 읽기·삽입·삭제와 서식 읽기까지만 해 봤고, 서식을 쓰는 함수는 해 보지 않았습니다)
  (`getCellParagraphCount/Length`, `getTextInCell`, `insertTextInCell`, `deleteTextInCell`, `getCellCharPropertiesAt`, `applyCharFormatInCell`,
  `getCellParaPropertiesAt`, `applyParaFormatInCell`). 경로 함수는 글·글자 서식만 되고 문단 서식 함수가 없습니다(글상자와 같은 한계).
- 캡션 만들기(시험 문서용): `setPictureProperties(구역, 문단, 컨트롤, '{"hasCaption":true}')`, `setTableProperties(…, '{"hasCaption":true}')`.
  표 속성에 `captionDirection`(기본 3)·`captionVertAlign`·`captionWidth`·`captionSpacing` 이 있다(캡션이 표 위/아래 어디인지 가리는 데 쓸 수 있을 듯하나 값의 뜻은 확인 못 함).

## 실험으로 확인한 것 (코어를 Node 에서 직접 불러서)

- 그림 캡션: 평평한 함수와 경로 함수 둘 다로 글 읽기·끝에 글 덧붙이기가 됨. 글자·문단 서식 읽기도 됨. HWP·HWPX 로 내보냈다 다시 읽어도 글이 같음.
- 표 캡션: 칸 번호 65534 로 글 읽기·덧붙이기·지우기·서식 읽기가 됨. 칸(다른 번호)의 글은 영향 없음.
  **HWP·HWPX 로 내보냈다 다시 읽으면 캡션 글 끝에 공백이 하나 더 붙음**(`"표   현황"` → `"표   현황 "`). 그림 캡션에서는 없었다. 원인 미확인(코어 동작).
- 코어가 새 캡션에 넣는 글은 `"그림  "`/`"표  "`(라벨 + 공백 둘). 그 두 공백 **사이에 자동 번호(번호 넣기, `atno`) 컨트롤**이 있고, 그것은 글에 나오지 않는다.

## 걸림돌: 자동 번호가 글 속 어디에 있는지 알 방법이 없다 (가장 중요)

- AI 에게는 `"그림  시스템 구성도"`(공백 둘)처럼 보입니다. 실제로는 `그림 [번호] 시스템 구성도` 입니다. **AI 가 "공백 둘"을 고치자고 제안할 가능성이 큽니다.**
- 코어의 글 삽입·삭제는 컨트롤을 지우지 않습니다(`Paragraph::insert_text_at/delete_text_at`). 그러나 바꾸는 범위 **한가운데**에 컨트롤이 있으면
  (예: 공백 둘을 하나로) 컨트롤이 글에 대해 자리를 옮기고, 되돌려도 원래 자리로 돌아오지 않습니다(소스를 읽고 따진 것이며, 실험은 못 함).
  범위의 가장자리에 컨트롤이 있을 때는 자리가 유지됩니다.
- 위치를 알려 주는 API 를 찾아 본 결과:
  - `getControls()`: 도형(Shape)의 캡션 안 컨트롤은 목록에 넣지만 **그림·표 캡션 안 컨트롤은 넣지 않음**(소스: `hwpctrl_sets.rs` `collect_controls`. 그림 캡션은 실험으로도 `atno` 가 안 나옴).
  - `getControlTextPositions(구역, 문단)`: 본문 문단 전용.
  - 경로 방식 `exportSelectionInCellHtmlByPath`·`copySelectionInCellByPath`: 번호가 글로 나오지 않음(앞부분 선택 [0,k)를 k=0..끝까지 해 봤으나 번호 흔적 없음).
  - 평평한 `exportSelectionInCellHtml`·`copySelectionInCell`: 표가 아니면 "표가 아님" 오류.
- 남은 후보(어느 것도 시도하지 않음):
  1. 내보낸 HWPX 의 XML(`hp:pic`/`hp:tbl` 아래 `hp:caption` > `hp:subList` > `hp:p` > `hp:run` > `hp:t`, 번호는 `hp:autoNum`)에서 위치를 읽는다.
     정확하다. 도형·묶음 개체의 `hp:caption` 이 XML 순서에 섞여 있어 `hp:pic`/`hp:tbl` 의 것만 골라야 한다. 웹 코드가 이미 내보낸 DOCX 의 XML 을 읽는 길
     (`web/src/engines/docx/styles.ts`)이 있다. HWP 도 `exportHwpx()` 로 내보내 읽을 수 있다.
  2. 보수적으로: 캡션 맨 앞 낱말(라벨)과 뒤따르는 공백을 건드리는 변경은 거절하고, 두 공백을 하나로 합치는 식의 제안이 나오지 않게 AI 에게 알린다. 위치를 몰라도 되지만 부정확하다.
  3. 캐럿 위치(`getCursorRectByPath`)의 가로 좌표 차이로 번호 자리를 추정. 글꼴 폭에 달려 있어 불안정할 듯.
- 어느 쪽이든 **번호가 글 속에 있다는 것을 AI 에게 알려야** 한다(예: 그 자리를 보이는 표지로 바꿔 AI 에게 보내고, 그 표지를 건드리는 변경은 거절).

## 설계 초안 (글상자를 만든 방식을 따른다)

- `HwpModel` 에 캡션 문단 칸을 더한다. 접근 방식이 둘이다: 그림 캡션은 경로 함수(어느 깊이든), 표 캡션은 평평한 함수에 65534
  (본문 문단의 표만. 그 밖의 캡션은 안 읽고 문서에 적는다). 문단 서식은 본문 문단에 바로 놓인 개체만(글상자와 같은 한계).
- 슬롯 순서: 개체가 든 문단 다음에 컨트롤 순서대로. 표 캡션은 표 칸 문단 앞/뒤 어느 쪽에 둘지 정해야 한다(캡션 방향 속성으로 가릴 수 있음).
- 카드 위치 문구: 표는 이미 "표 2 · 3행 1열"처럼 표 번호를 쓰므로 표 캡션은 "표 2 캡션", 그림은 "그림 캡션 N"(캡션이 달린 그림을 문서 순서로 센 번호)이 자연스럽다.
  공유 타입은 `shared/src/style.ts`(`AreaPlace`, `areaLabel`, `areaName`), AI 프롬프트와 데모 AI 는 `server/src/ai/prompt.ts`·`mock.ts`.
- 서식 점검(일관성·기준 문서)은 본문만 비교하고, 서식 규칙은 "캡션"을 적었을 때만 캡션에 적용(글상자와 같은 규칙).
- "문서에서 보기": 편집기 패치 `__alldocFocusCell`(`web/scripts/build-rhwp-studio.mjs`)이 그림 캡션·표 캡션으로 가는지는 확인하지 못했다. 못 가면 개체가 든 문단으로 이동하고 알린다.

## 이어서 하는 법 (로컬)

```bash
git clone https://github.com/ZN9812/AllDoc.git && cd AllDoc
git checkout claude/web-document-editor-design-4kd6km
npm ci
npm run build                      # 한글 편집기(rhwp-studio)와 예제 문서를 .cache 에 받는다
npm run typecheck && npm test
REQUIRE_HWP_SAMPLES=1 npm test -w web -- src/engines/hwp/corpus.test.ts   # 예제 12개 대조
npx playwright test e2e/hwp-box.spec.ts e2e/hwp.spec.ts --project=desktop  # 종단 시험(빌드 뒤)
```

- 예제 900개 전체(일회성 확인용)와 코어 소스를 보려면 rhwp 를 따로 받는다: `git clone --filter=blob:none https://github.com/edwardkim/rhwp.git`
  후 `git checkout v0.8.6`, `samples/` 와 `src/` 를 본다. 이 저장소의 `.cache` 는 예제 12개만 sparse 로 받는다.
- 조사에 쓴 임시 스크립트는 클라우드 컨테이너 안에만 있어 남지 않았다. 필요한 호출은 위 표와 실험 항목에 적었다.
