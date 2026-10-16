// 빌드된 웹 앱(web/dist)을 제공한다. 이 사이트의 주소(/docs, /edit/...)는 브라우저 안에서 처리되므로 파일이 없는 주소는 index.html 로 보낸다.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { Context } from 'hono';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.icc': 'application/octet-stream',
};

// 파일 이름에 해시가 붙은 결과물이 놓이는 폴더(앱, 한글 편집기). 이름이 같으면 내용도 같으므로 오래 캐시한다.
const HASHED_DIRS = [join('assets'), join('rhwp-studio', 'assets')];

/** 해시 폴더 안의 실제 파일인지. 주소 글자가 아니라 해석된 파일 경로로 본다(/assets/..%2findex.html 이나 없는 주소가 대신 받는 index.html 은 해시 파일이 아니다). */
const isHashed = (root: string, file: string) => HASHED_DIRS.some((dir) => relative(root, file).startsWith(dir + sep));

const opaqueTag = (tag: string) => tag.trim().replace(/^W\//, '');

/** 브라우저가 가진 사본이 아직 맞는지(RFC 9110 13.1). If-None-Match 가 있으면 그것만 보고, 없으면 If-Modified-Since 로 본다. */
function isNotModified(ifNoneMatch: string | undefined, ifModifiedSince: string | undefined, etag: string, mtimeMs: number): boolean {
  if (ifNoneMatch !== undefined) return ifNoneMatch.trim() === '*' || ifNoneMatch.split(',').some((t) => opaqueTag(t) === opaqueTag(etag));
  const since = Date.parse(ifModifiedSince ?? '');
  return !Number.isNaN(since) && Math.floor(mtimeMs / 1000) * 1000 <= since;
}

function fileIn(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const full = resolve(join(root, decoded));
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

export function createStaticHandler(webDist: string) {
  const root = resolve(webDist);

  return async (c: Context) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.text('Method Not Allowed', 405);

    const urlPath = new URL(c.req.url).pathname;
    let file = fileIn(root, urlPath);
    if (file === null) return c.text('Not Found', 404);

    let isIndex = false;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      // 확장자가 있는 주소(/assets/x.js)는 진짜 파일 요청이므로 없으면 404, 그 밖의 주소는 앱 화면 주소로 본다.
      if (extname(urlPath) !== '') return c.text('Not Found', 404);
      file = join(root, 'index.html');
      if (!existsSync(file)) return c.text('웹 앱이 빌드되지 않았어요. npm run build 를 실행하세요.', 503);
      isIndex = true;
    }

    const stat = statSync(file);
    const ext = extname(file);
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const cacheHeaders = {
      // 해시가 붙은 결과물은 오래 캐시하고, 나머지(index.html 등)는 매번 확인한다(바뀌지 않았으면 304 로 본문 없이 끝난다).
      'cache-control': isHashed(root, file) ? 'public, max-age=31536000, immutable' : 'no-cache',
      etag,
      'last-modified': stat.mtime.toUTCString(),
    };
    if (isNotModified(c.req.header('if-none-match'), c.req.header('if-modified-since'), etag, stat.mtimeMs)) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }

    const headers: Record<string, string> = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': String(stat.size),
      ...cacheHeaders,
    };
    if (isIndex || ext === '.html') headers['content-type'] = TYPES['.html'] as string;

    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
  };
}
