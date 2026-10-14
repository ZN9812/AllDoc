// 일꾼을 dist/main.js 하나로, 탈출 시험 묶음을 dist/escape.js 로 묶는다(이미지 안에서 node 만으로 돈다).
import { build } from 'esbuild';

await build({
  entryPoints: { main: 'src/main.ts', escape: 'test/escape/run.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
});
