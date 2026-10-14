# LaTeX 템플릿

홈 화면의 "LaTeX 새 프로젝트"에서 고르는 템플릿입니다. 빌드할 때 `web/scripts/pack-templates.mjs` 가 폴더마다 ZIP 하나(`web/public/templates/<이름>.zip`)와 목록(`index.json`)으로 묶습니다.

| 폴더 | 엔진 | 내용 |
| --- | --- | --- |
| `ko-article` | XeLaTeX + kotex | 한국어 짧은 논문: 요약·절·수식·표 |
| `ko-report` | XeLaTeX + kotex, biblatex(biber) | 한국어 보고서·학위논문 초안: 장·차례·참고문헌, 장마다 파일 |
| `en-article` | pdfLaTeX | 영어 논문 |
| `ko-beamer` | XeLaTeX + kotex + beamer | 한국어 발표 자료(16:9) |

- 모두 이 저장소에서 직접 쓴 것입니다. 학교 학위논문 양식·로고는 넣지 않습니다(라이선스·상표).
- 한국어 템플릿은 글꼴을 Noto Serif/Sans CJK KR 로 정해 둡니다(컴파일 일꾼 이미지에 들어 있는 글꼴). `\usepackage[hangul]{kotex}` 로 날짜·장 제목을 한국어 방식으로 하고, 표·그림 제목 이름도 따로 정합니다(`article` 의 기본값은 "Table", "Figure").
- 폴더의 `template.json` 은 화면에 보이는 제목·설명·새 프로젝트 이름입니다.

## 라이선스: 결정 필요

사용자의 논문이 AGPL 에 얽히지 않도록 템플릿만 따로 CC0 또는 MIT 로 내놓을 계획입니다(`docs/LATEX.md` "템플릿"). **어느 쪽으로 할지 아직 정하지 않았습니다.** 정하기 전까지 이 폴더는 저장소 전체 라이선스(AGPL-3.0)를 따릅니다.

## 확인한 것 (2026-10-14, 이 환경에서 한 번 해 본 것이며 CI 에서는 돌지 않는다)

Ubuntu 24.04 패키지의 TeX Live 2023 으로 `latexmk -norc -<엔진> -interaction=nonstopmode -file-line-error` 를 깨끗한 폴더에서 한 번씩 돌렸습니다.

| 템플릿 | 결과 | 시간 | PDF 크기 |
| --- | --- | --- | --- |
| ko-article | 성공, 경고 0 | 2.9초 | 42,646 바이트 |
| ko-report | 성공, 경고 0 | 9.2초(latexmk 가 xelatex 여러 번 + biber) | 40,109 바이트 |
| en-article | 성공, 경고 0 | 0.9초 | 159,323 바이트 |
| ko-beamer | 성공, 경고 0 | 3.9초 | 8,767 바이트 |

- `pdftotext` 결과에 "논문 제목을 여기에 씁니다", "표 1은 결과를 정리한 것이다", "2026년 10월 14일", "제1 장" 같은 한글이 그대로 나왔습니다.
- ko-article 첫 쪽은 그림으로 그려 눈으로 봤습니다(한글·수식·표가 바르게 나옴). 나머지는 그림으로 보지 않았습니다.
- PDF 안 글꼴 이름이 `NotoSerifCJKjp-Regular` 로 나오는데, Noto CJK 의 TTC 파일은 한·중·일 얼굴이 글리프 표(CFF)를 함께 써서 이름이 하나뿐입니다. 템플릿 설정으로 그린 글자와 KR 얼굴(TTC 색인 1)을 직접 지정해 그린 글자가 그림으로 같았습니다(한자 3글자, 40dpi 비교). 한자 자형이 한국식으로 나오는지 더 넓게 보지는 않았습니다.
