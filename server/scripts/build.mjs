// 서버를 dist/main.js 하나로 묶는다. node: 내장 모듈(node:sqlite 등)은 그대로 둔다.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // 일부 의존성이 CommonJS 의 require/__dirname 을 쓸 수 있어 호환용 껍데기를 넣는다.
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
