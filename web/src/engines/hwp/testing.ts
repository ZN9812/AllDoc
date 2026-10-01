// 시험 전용: Node 에서 진짜 @rhwp/core(WASM)를 불러오고, 시험용 문서를 만든다. 화면 코드에서는 쓰지 않는다.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { HwpDocument, initSync } from '@rhwp/core';
import { HwpModel, type HwpFormat } from './model';

let ready = false;

export function loadNodeCore(): typeof HwpDocument {
  if (!ready) {
    // 코어는 글자 폭 계산을 브라우저에 맡긴다. Node 에는 canvas 가 없으므로 글자 수에 비례하는 근사값을 쓴다.
    (globalThis as { measureTextWidth?: (font: string, text: string) => number }).measureTextWidth = (font, text) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16);
      let w = 0;
      for (const ch of text) w += ch.charCodeAt(0) > 0x2000 ? size : size / 2;
      return w;
    };
    const wasm = createRequire(import.meta.url).resolve('@rhwp/core/rhwp_bg.wasm');
    initSync({ module: readFileSync(wasm) });
    ready = true;
  }
  return HwpDocument;
}

/** 줄마다 한 문단인 문서를 만들어 파일(바이트)로 내보낸 뒤 다시 연다(실제 파일을 여는 것과 같은 경로). */
export function openSample(lines: string[], format: HwpFormat = 'hwp', tweak?: (doc: HwpDocument) => void): { doc: HwpDocument; model: HwpModel } {
  const Doc = loadNodeCore();
  const built = Doc.createEmpty();
  built.createBlankDocument();
  let p = 0;
  lines.forEach((line, i) => {
    if (line) built.insertText(0, p, 0, line);
    if (i < lines.length - 1) {
      built.splitParagraph(0, p, built.getParagraphLength(0, p));
      p++;
    }
  });
  tweak?.(built);
  const bytes = format === 'hwpx' ? built.exportHwpx() : built.exportHwp();
  const doc = new Doc(new Uint8Array(bytes));
  return { doc, model: new HwpModel(doc, format) };
}
