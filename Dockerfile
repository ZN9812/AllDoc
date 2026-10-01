# AllDoc 이미지: 빌드 단계에서 웹·서버를 만들고, 실행 단계에는 결과물만 담는다.
#   docker build -t alldoc .
#   docker run -p 8787:8787 --env-file .env -v alldoc-data:/data alldoc
# 자세한 배포 방법은 docs/DEPLOY.md 를 보세요.

# ---- 1단계: 빌드 ----
# git 이 들어 있는 전체 이미지를 쓴다: 한글 편집기(rhwp-studio)를 정해 둔 커밋의 소스에서 받아 빌드하기 때문이다.
FROM node:22-bookworm AS build
WORKDIR /app

# 의존성 설치는 소스보다 먼저 해서, 소스만 바뀐 빌드에서는 이 단계를 다시 쓰게 한다.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --no-audit --no-fund

COPY . .
# 한글 편집기를 준비하지 못하면 빌드를 멈춘다(HWP·HWPX 편집이 빠진 이미지가 조용히 만들어지지 않도록).
ENV RHWP_STUDIO_STRICT=1
# 빌드 옵션(docs/DEPLOY.md). 값을 주지 않으면 설정되지 않은 채로 빌드된다. 예:
#   docker build --build-arg VITE_DISABLE_DOCX=1 --build-arg VITE_SOURCE_URL=https://github.com/me/fork -t alldoc .
ARG VITE_DISABLE_DOCX
ARG VITE_SOURCE_URL
RUN npm run build

# ---- 2단계: 실행 ----
# 서버는 의존성을 포함해 dist/main.js 하나로 묶여 있어 node_modules 가 필요 없다(SQLite 는 Node 내장 모듈).
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./

# 사용자 수·한도 같은 데이터(SQLite)는 /data 에 둔다. 컨테이너를 지워도 남도록 볼륨으로 이어 쓰세요.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/main.js"]
