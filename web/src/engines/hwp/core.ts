// 브라우저에서 @rhwp/core(WASM)를 한 번만 불러온다. 편집 화면은 편집기(iframe) 안에 따로 있고,
// 여기서 불러오는 것은 AI·서식 점검이 문단과 서식을 읽고 고치는 데 쓰는 "화면 없는" 문서 객체다.
import wasmUrl from '@rhwp/core/rhwp_bg.wasm?url';
import type { HwpDocument } from '@rhwp/core';

let loading: Promise<typeof HwpDocument> | null = null;

/** 코어는 글자 폭 계산을 브라우저에 맡긴다. */
function installMeasureTextWidth(): void {
  let ctx: CanvasRenderingContext2D | null = null;
  let lastFont = '';
  (globalThis as { measureTextWidth?: (font: string, text: string) => number }).measureTextWidth = (font, text) => {
    ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return text.length * 8;
    if (font !== lastFont) {
      ctx.font = font;
      lastFont = font;
    }
    return ctx.measureText(text).width;
  };
}

export function loadHwpCore(): Promise<typeof HwpDocument> {
  loading ??= (async () => {
    installMeasureTextWidth();
    const core = await import('@rhwp/core');
    await core.default({ module_or_path: wasmUrl });
    return core.HwpDocument;
  })();
  loading.catch(() => {
    loading = null; // 실패했으면 다음에 다시 시도할 수 있게 한다.
  });
  return loading;
}
