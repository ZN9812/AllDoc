# 배포 방법

서버 한 대에서 Docker로 띄우는 방법을 먼저 설명하고, Docker 없이 띄우는 방법과 공개 전 점검표를 이어서 적었습니다.

> **공개 운영 전에 꼭 읽으세요: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)의 "SuperDoc의 독점 DOCX 엔진".**
> Word(DOCX) 편집에 쓰는 부품 하나가 오픈소스가 아닌 독점 라이선스입니다. 운영 형태에 맞는지 SuperDoc과 변호사에게 확인하거나, 아래 "Word 지원 없이 배포하기"로 끄고 배포하세요.

## 준비물

- 서버(리눅스 권장)와 Docker. 문서 처리는 사용자의 브라우저가 하고, 서버는 로그인·횟수 관리·AI 중계·정적 파일만 합니다. 시험 중 서버 컨테이너는 종단 시험 전체를 돌린 뒤에도 메모리를 약 85MB 썼습니다(실제 사용자 수에 따른 부하는 확인하지 않았습니다).
- 도메인과 HTTPS. 구글 로그인이 HTTPS 주소를 요구하고, 쿠키도 HTTPS에서만 안전하게 쓰입니다.
- 구글 로그인 클라이언트(아래 "구글 로그인 설정"), AI를 쓸 거라면 Anthropic API 키.

## 설정 값

`.env.example`을 `.env`로 복사해 채웁니다. `.env`는 저장소에 올리지 마세요(이미 `.gitignore`에 있습니다).

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `PUBLIC_URL` | 예 | 사용자가 접속하는 주소(예: `https://docs.example.com`). 구글 로그인 되돌아오기 주소와 쿠키 설정에 쓰입니다. `https://`로 시작하면 보안 쿠키·HSTS가 켜집니다. |
| `SESSION_SECRET` | 예 | 로그인 세션 서명용 비밀 문자열, 32자 이상. `openssl rand -hex 32` |
| `AUTH_MODE` | 예 | `google`(운영) · `none`(로그인 없이 AI 사용, 한도 없음, 사내망용) · `dev`(개발용 가짜 로그인, 운영에서는 시작되지 않습니다) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `google`일 때 | 구글 OAuth 클라이언트 |
| `AI_PROVIDER` | 아니오 | `anthropic`(기본) · `mock`(데모) · `off`. 자세한 내용은 [AI.md](AI.md) |
| `ANTHROPIC_API_KEY` | `anthropic`일 때 | 서버에만 둡니다. |
| `AI_CONFIG_PATH` | 아니오 | 작업별 모델·시스템 프롬프트 설정 파일(JSON). [AI.md](AI.md) |
| `DAILY_AI_LIMIT` | 아니오 | 사용자별 하루 AI 요청 수(기본 5) |
| `APP_TIMEZONE` | 아니오 | 하루가 바뀌는 시간대(기본 `Asia/Seoul`) |
| `PORT` | 아니오 | 서버가 듣는 포트(기본 8787). Docker에서는 그대로 두고 바깥 포트만 바꾸는 편이 쉽습니다. |
| `DATA_DIR` | 아니오 | SQLite(사용 횟수)를 둘 폴더. 이미지 안에서는 `/data` |
| `ALLOWED_ORIGINS` | 아니오 | `PUBLIC_URL` 외에 요청을 받아들일 출처(쉼표로 구분). 보통 필요 없습니다. |

설정이 잘못되면 서버가 켜질 때 무엇이 문제인지 한국어로 알려 주고 멈춥니다.

## 구글 로그인 설정

로그인은 AI 사용 횟수를 사용자별로 관리하려는 용도로만 씁니다(문서는 로그인과 상관없이 브라우저에만 저장됩니다).

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만들고 "API 및 서비스 → OAuth 동의 화면"을 설정합니다.
2. "사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 웹 애플리케이션"을 고릅니다.
3. **승인된 리디렉션 URI**에 `{PUBLIC_URL}/api/auth/callback`을 넣습니다(예: `https://docs.example.com/api/auth/callback`).
4. 발급된 클라이언트 ID와 보안 비밀을 `.env`의 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`에 넣습니다.

서버는 인증 코드 방식(PKCE 포함)으로 로그인하고, 이름·이메일은 세션 쿠키에만 담습니다. 서버 저장소에는 사용자 번호와 날짜별 사용 횟수만 남습니다.

## Docker로 실행

```bash
docker compose up -d --build        # .env 를 먼저 채우세요
docker compose logs -f alldoc       # "서버가 … 실행 중입니다" 가 보이면 됩니다
```

또는 compose 없이:

```bash
docker build -t alldoc .
docker run -d --name alldoc --restart unless-stopped -p 8787:8787 --env-file .env -v alldoc-data:/data alldoc
```

- 빌드할 때 **한글 편집기(rhwp-studio)를 GitHub에서 받아 빌드**합니다(정해 둔 버전·커밋과 다르면 중단). 그래서 빌드하는 곳은 인터넷(GitHub, npm)에 나갈 수 있어야 합니다.
  Docker 빌드는 한글 편집기를 준비하지 못하면 **실패**하도록 되어 있습니다(`RHWP_STUDIO_STRICT=1`). HWP 편집이 빠진 이미지가 조용히 만들어지지 않게 하려는 것입니다.
- 이미지는 컨테이너 안에서 일반 사용자(`node`)로 실행되고, 사용 횟수 데이터는 `/data`(볼륨)에 저장됩니다. 컨테이너를 지워도 볼륨은 남습니다.
- 건강 확인(`/api/health`)이 이미지에 들어 있어 `docker ps`에서 `healthy`로 보입니다.
- 이 저장소의 Dockerfile로 이미지를 처음부터 빌드(npm ci, 한글 편집기 받기·빌드, 웹·서버 빌드)해서 컨테이너로 띄우고, 같은 종단 시험(데스크톱·휴대폰)을 그 컨테이너에 돌려 통과한 것을 확인했습니다.
  이 확인은 인터넷에 나가려면 프록시가 필요한 시험 환경에서, 프록시 설정 몇 줄만 덧붙인 같은 Dockerfile로 했습니다. 덧붙인 줄을 뺀 Dockerfile 그대로는 빌드해 보지 못했습니다.
  운영 설정(구글 로그인, 진짜 AI)은 키가 있어야 해서 이 확인에 들어 있지 않습니다. `docker-compose.yml`은 `docker compose config`로 문법만 확인했습니다.

### 업데이트

```bash
git pull
docker compose up -d --build
```

### 백업

사용 횟수는 하루가 지나면 의미가 없어서 잃어도 큰일은 아닙니다. 그래도 옮기거나 보관하려면 볼륨의 `alldoc.sqlite*` 파일을 서버를 멈춘 상태에서 복사하세요.
**사용자의 문서는 서버에 없습니다.** 각자의 브라우저에 있으므로 서버 백업으로는 복구되지 않습니다(사용자가 "내려받기"로 보관해야 합니다).

## 역방향 프록시(HTTPS)

서버는 HTTP로 듣고, HTTPS는 앞단의 프록시가 맡습니다. 프록시는 `X-Forwarded-*` 없이도 동작하지만(주소는 `PUBLIC_URL`만 봅니다), 요청 본문 크기 제한은 4MB 이상이어야 합니다(AI 요청).

Caddy 예시(자동으로 HTTPS 인증서를 받습니다):

```
docs.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

nginx 예시:

```nginx
server {
    listen 443 ssl http2;
    server_name docs.example.com;
    # ssl_certificate ... (인증서 설정)
    client_max_body_size 5m;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
    }
}
```

서버가 보안 헤더(CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, HTTPS일 때 HSTS)를 직접 붙입니다. 프록시에서 덮어쓰지 마세요.
**한글 편집기는 `/rhwp-studio/` 아래에서 같은 주소로 제공**되므로 다른 도메인으로 나눌 필요가 없습니다.

## Docker 없이 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm ci
npm run build                 # 웹 → server/dist/main.js 와 web/dist
cp .env.example .env          # 값을 채운 뒤
set -a; . ./.env; set +a
NODE_ENV=production npm start
```

운영 모드(`NODE_ENV=production`)에서는 서버가 `.env`를 직접 읽지 않으므로, 위처럼 값을 환경에 먼저 넣어야 합니다(개발 모드에서는 `.env`를 자동으로 읽습니다).

서버는 의존성을 포함해 `server/dist/main.js` 하나로 묶여 있고, 웹 파일은 `web/dist`를 읽습니다(`WEB_DIST`로 위치를 바꿀 수 있습니다). SQLite는 Node.js 내장 모듈이라 따로 설치할 것이 없습니다.
systemd로 띄운다면 `EnvironmentFile=`에 `.env`를 지정하고 `ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning server/dist/main.js`를 쓰세요.

## 빌드 옵션

| 환경 변수 | 설명 |
| --- | --- |
| `RHWP_STUDIO_STRICT=1` | 한글 편집기 빌드가 실패하면 전체 빌드를 멈춥니다(Docker 이미지는 기본으로 켭니다). 끄면 경고만 하고 계속하며, 그 경우 HWP·HWPX는 열리지 않고 나머지 형식은 정상입니다. |
| `RHWP_STUDIO_SKIP=1` | 한글 편집기 빌드를 건너뜁니다(HWP·HWPX를 쓰지 않는 개발용). |
| `VITE_DISABLE_DOCX=1` | Word(DOCX) 지원을 빼고 빌드합니다(아래). |
| `VITE_SOURCE_URL` | 설정 화면에 보여 줄 소스 코드 주소. 포크해서 운영한다면 자신의 저장소 주소로 지정하세요(AGPL). |

한글 편집기는 `.cache/rhwp-studio`에 소스를 받아 `web/public/rhwp-studio`로 빌드하며, 같은 버전이 이미 빌드되어 있으면 건너뜁니다.

### Word 지원 없이 배포하기

```bash
VITE_DISABLE_DOCX=1 npm run build
# Docker:
docker build --build-arg VITE_DISABLE_DOCX=1 -t alldoc .
```

이렇게 빌드하면 SuperDoc과 그 DOCX 엔진이 결과물에 들어가지 않고(시험 빌드에서 `web/dist/assets`가 약 121MB에서 약 21MB로 줄었습니다. 소스맵 포함),
홈의 지원 형식 목록과 파일 선택 창에서 DOCX가 빠지며, DOCX 파일을 올리면 "이 서버에서는 Word(DOCX) 문서를 지원하지 않아요"라고 안내합니다.
이미 브라우저에 저장된 DOCX 문서를 열면 같은 취지의 안내가 나옵니다. 다른 형식은 그대로 동작합니다(종단 시험 `e2e/docx-disabled.spec.ts`).

## 공개 전 점검표

- [ ] **SuperDoc 독점 엔진 라이선스를 확인했다**(또는 Word 지원을 끄고 배포한다). [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
- [ ] 이름과 로고를 정했다. "AllDoc"은 임시 이름이고 비슷한 이름의 앱이 있습니다. 상표와 도메인을 확인하세요(`web/src/brand/`).
- [ ] 개인정보 처리 방침을 만들었다. 이 서비스는 로그인한 사용자의 이름·이메일을 세션 쿠키에, 사용자 번호와 날짜별 AI 사용 횟수를 서버에 둡니다. AI를 쓰면 **문서의 글이 AI 서비스(Anthropic)로 전송**됩니다(처음 쓸 때 동의 창으로 알립니다). 법적 고지 문구는 직접 검토하세요.
- [ ] 실제 API 키로 "AI 대화"와 "내 규칙"을 한 번씩 돌려 보고, 서버 기록에 경고가 없는지 확인했다. 이 저장소의 시험은 가짜 AI·가짜 클라이언트로만 돌았습니다([AI.md](AI.md)).
- [ ] Anthropic 콘솔에 월 지출 한도를 걸었고, `DAILY_AI_LIMIT`을 정했다.
- [ ] 구글 로그인을 실제 도메인에서 끝까지 해 봤다(로그인 → AI 사용 → 로그아웃).
- [ ] HTTPS이고, `SESSION_SECRET`이 충분히 긴 무작위 값이다.
- [ ] 한글(HWP·HWPX)·Word 문서를 **실제 업무 파일**로 열고, 고치고, 내려받아 한글·Word에서 다시 열어 보았다(아래 한계 참고).
- [ ] 소스 코드 공개 주소가 맞다. 설정 화면에 `VITE_SOURCE_URL`(기본 이 저장소)이 표시됩니다. 포크해서 고쳐 운영한다면 자신의 저장소 주소를 지정하세요(AGPL: 서비스 이용자가 소스를 받을 수 있어야 합니다).

## 알려진 한계

- **글꼴**: 한컴·Microsoft의 저작권 있는 글꼴(함초롬, 맑은 고딕 등)은 포함하지 않습니다. 사용자 컴퓨터에 없으면 대체 글꼴로 보이고, 줄바꿈·쪽 나눔이 원본과 다를 수 있습니다. 글꼴 이름은 파일에 그대로 남습니다.
- **한글(HWP·HWPX)**: 편집 화면과 저장은 rhwp가 합니다. rhwp는 아직 모든 문서를 완벽히 다루지는 못합니다(시험 문서 중 하나에서 읽고 다시 저장한 글이 달라진 적이 있습니다). AI 변경을 적용하기 전에 저장했을 때 빠지는 요소가 있는지 검사하고, 있으면 문서를 건드리지 않고 알려 줍니다. 중요한 문서는 원본을 따로 보관하세요.
  - rhwp 저장소의 예제 한글 문서 12개로 열기·서식 점검 제안 적용·내보내기·다시 읽기·되돌리기를 시험했고 글이 달라지거나 사라진 곳은 없었습니다(`web/src/engines/hwp/corpus.test.ts`). 다만 다시 읽는 쪽도 같은 rhwp여서, 한컴오피스에서 같게 열리는지는 확인하지 못했습니다.
  - **표 안의 글**: AI 대화·내 규칙은 표 칸 안의 글(표 안의 표 포함)도 읽고 고칩니다. 예제 12개의 표를 빠짐없이 찾고, 글이 표 안에만 있던 양식 3개(블로그 양식 7개, `form-002.hwpx` 334개, 중첩 표 문서 1,588개)에서 표 안 글을 읽습니다. 한계는 다음과 같습니다.
    - **서식 점검(문서 안 일관성·기준 문서)은 표 밖 본문만 비교합니다.** 표 칸의 글은 칸마다 서식이 다른 게 보통이라 본문과 묶으면 잘못된 지적이 나옵니다. 표 안의 글은 AI 대화(맞춤법·말투)와 내 규칙으로 고칩니다. AI에게는 서식 규칙을 표를 언급하지 않았다면 표 밖에만 적용하라고 알립니다.
    - **표 안의 표 칸의 문단 서식(정렬·줄 간격)은 바꾸지 못합니다.** 코어가 그 칸의 문단 서식을 읽고 쓰는 방법을 주지 않습니다. 글 바꾸기와 글자 서식(글꼴·크기·굵게 등)은 됩니다. 이런 변경은 적용할 때 이유와 함께 거절됩니다.
    - **"문서에서 보기"는 표 칸이 아니라 그 표가 있는 곳으로 이동합니다.** 한글 편집기가 본문 문단으로만 이동할 수 있습니다. 화면에 그렇다고 알리고, 카드에 표 번호·행·열이 적혀 있습니다.
    - 표 안의 글을 편집 화면에서 직접 고치는 것은 rhwp 편집기의 기능이며, 이 저장소에서는 따로 시험하지 않았습니다.
  - **글상자·머리말·꼬리말·각주 안의 글은 읽지 못합니다.** 편집 화면에도 같은 안내가 있습니다.
- **Word(DOCX)**: 저장은 SuperDoc이 만든 DOCX입니다. 원본과 파일 안의 XML 표기(요소 순서 등)가 달라질 수 있습니다. LibreOffice 24.2로는 확인했습니다(LibreOffice가 만든 표 있는 단순 문서를 고쳐 내려받은 파일이 열리고, 고친 두 줄 말고는 글이 같고, PDF로도 변환됩니다. `e2e/interop.spec.ts`). Microsoft Word·한컴오피스에서 열었을 때의 호환은 확인하지 못했습니다. AI는 본문과 표 안의 글(표 안의 표 포함)을 다루고 머리말·꼬리말·각주는 다루지 않습니다. 카드에는 표 번호·행·열이 적히며, 칸을 가로·세로로 합친 표도 SuperDoc 화면에서 시험했습니다(`e2e/docx-table.spec.ts`). 서식 점검(문서 안 일관성·기준 문서)은 한글 문서와 같이 표 밖 본문만 비교합니다(표 칸의 서식은 칸마다 다른 게 보통이라, 섞으면 양식의 제목 칸이 본문과 다르다는 잘못된 지적이 나옵니다. 실제 SuperDoc 화면에서 이 오탐을 재현해 확인한 뒤 고쳤습니다). 되돌리기는 화면에 보이는 모양을 원래대로 돌리며, 파일 안의 서식 표기 방식은 달라질 수 있습니다.
- **PDF**: 보기만 됩니다. 한글 문서의 PDF 저장은 한글 편집기의 인쇄 창을 엽니다(브라우저가 PDF로 저장). Word 문서의 PDF 저장은 아직 없습니다.
- **휴대폰**: Chromium 에뮬레이션(Pixel 7)으로 화면 배치와 단추 크기를 시험했습니다. 실제 기기(터치 입력, 한글 입력기, 가상 키보드)에서는 시험하지 못했습니다. Word 편집기의 도구는 영어 보조 문구(접근성 라벨 등)가 일부 남아 있습니다.
- **AI**: 제안이 문서에 맞는지 서버가 걸러 주지만, 제안의 **내용이 옳은지**는 보장하지 못합니다. 그래서 항상 사용자가 적용 여부를 정합니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| "이 서버에는 한글 편집기가 설치되어 있지 않아요" | 빌드 기록에서 "한글 편집기" 경고를 찾으세요. 빌드하는 곳이 GitHub에 못 나갔을 가능성이 큽니다. `RHWP_STUDIO_STRICT=1`로 빌드하면 그때 멈춰 알려 줍니다. |
| 구글 로그인 후 `/?login=failed` | 승인된 리디렉션 URI가 `{PUBLIC_URL}/api/auth/callback`과 정확히 같은지, `PUBLIC_URL`이 사용자가 실제로 접속하는 주소인지 확인하세요. 서버 기록에 실패 이유가 남습니다. |
| "AI 서비스 인증에 문제가 있어요" | `ANTHROPIC_API_KEY`가 맞는지, 키에 해당 모델을 쓸 권한이 있는지 확인하세요. |
| "이 서버에는 AI가 연결되어 있지 않아요" | `AI_PROVIDER`와 키를 확인하세요. 키가 없으면 서버가 켜질 때 경고를 남깁니다. |
| 서버가 켜지자마자 멈춤 | 출력된 설정 문제 목록을 읽으세요(필수 값 누락, 잘못된 AI 설정 파일 등). |
