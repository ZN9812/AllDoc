# LaTeX 컴파일 일꾼 이미지(앱 이미지와 따로). 저장소 루트에서 만든다:
#   docker build -f compiler/Dockerfile -t alldoc-compiler .
# 실행 설정(내부망, 읽기 전용 루트, cap_drop ALL, seccomp 프로필, 자원 상한)은 docker-compose.yml 의 compiler 서비스를 본다.
#
# TeX Live 는 Debian bookworm 패키지(TeX Live 2022)다. 설계(docs/LATEX.md "이미지")의 install-tl 연도 스냅숏으로 바꿀지는 결정 필요.

# ---- 1단계: 일꾼 프로그램 묶기 ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY server/package.json server/
COPY compiler/package.json compiler/
RUN npm ci --no-audit --no-fund -w compiler -w shared --include-workspace-root=false
COPY shared shared
COPY compiler compiler
RUN cd compiler && node scripts/build.mjs

# ---- 2단계: TeX Live + 글꼴 + bubblewrap ----
FROM node:22-bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive
# 넣을 묶음(초안, docs/LATEX.md): latex·recommended·extra, 글꼴, 수학·과학, 그림, 참고문헌(biber), xetex·luatex, 한국어·CJK, latexmk
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended \
      texlive-science texlive-pictures texlive-plain-generic texlive-bibtex-extra biber \
      texlive-xetex texlive-luatex texlive-lang-korean texlive-lang-cjk texlive-lang-english latexmk \
      fonts-noto-cjk fonts-nanum \
      bubblewrap util-linux ca-certificates \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/*
# 루트가 읽기 전용이라 작업마다 만들지 않도록 글꼴 목록과 LuaTeX 글꼴 캐시를 미리 만든다(첫 LuaLaTeX 75초 → 캐시 사용).
RUN fc-cache -f && luaotfload-tool -u && mktexlsr

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin compiler && mkdir -p /work && chown compiler:compiler /work
WORKDIR /app
COPY --from=build /app/compiler/dist ./dist
COPY LICENSE ./
USER compiler
ENV NODE_ENV=production PORT=8790 WORK_DIR=/work
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8790)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
