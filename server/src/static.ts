// 빌드된 웹 앱(web/dist)을 제공한다. 이 사이트의 주소(/docs, /edit/...)는 브라우저 안에서 처리되므로 파일이 없는 주소는 index.html 로 보낸다.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
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
    const headers: Record<string, string> = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': String(stat.size),
      // 파일 이름에 해시가 붙은 결과물은 오래 캐시하고, 나머지(index.html 등)는 매번 확인한다.
      'cache-control': urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'last-modified': stat.mtime.toUTCString(),
    };
    if (isIndex || ext === '.html') headers['content-type'] = TYPES['.html'] as string;

    if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers });
  };
}
