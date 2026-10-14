import { useEffect, useRef, useState, type Ref } from 'react';
// 오래된 브라우저(기관 PC 등)에서도 열리도록 pdf.js 의 호환(legacy) 빌드를 쓴다.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

export interface PageBox {
  w: number;
  h: number;
}

export interface PdfViewProps {
  /** PDF 바이트. pdf.js 가 받은 버퍼를 작업 스레드로 넘겨 버리므로 여기서 사본을 넘긴다(원본은 부르는 쪽이 내려받기용으로 둔다). */
  bytes: Uint8Array;
  zoom: number;
  /** 쪽 너비(CSS 픽셀, 확대 100% 기준). fit 이면 바깥 상자 너비에 맞춘다 */
  pageWidth?: number;
  fit?: boolean;
  className?: string;
  /** 문서를 열었을 때(새 바이트마다 한 번) */
  onDocument?(pdf: PDFDocumentProxy, boxes: PageBox[]): void;
  onError?(message: string): void;
  ref?: Ref<HTMLDivElement>;
}

/**
 * PDF를 쪽마다 캔버스로 그린다. 보이는 쪽만 그려서 큰 문서도 가볍게 연다. PDF 문서 보기(PdfEngine)와 LaTeX 미리보기가 같이 쓴다.
 * 새 바이트가 오면 새 문서를 다 연 뒤에 바꿔 끼워서(그 사이 옛 쪽을 그대로 보여 줌) 스크롤 위치가 튀지 않게 한다.
 */
export default function PdfView({ bytes, zoom, pageWidth = 820, fit = false, className = 'pdf-engine', onDocument, onError, ref }: PdfViewProps) {
  const [doc, setDoc] = useState<{ pdf: PDFDocumentProxy; boxes: PageBox[]; gen: number } | null>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const outer = useRef<HTMLDivElement | null>(null);
  const gen = useRef(0);

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    let finished = false;
    const my = ++gen.current;
    (async () => {
      try {
        task = pdfjs.getDocument({
          data: bytes.slice(),
          // 글꼴이 들어 있지 않은 한글 PDF와 특수 이미지를 그리는 보조 파일(빌드 때 public/pdfjs 로 복사됨)
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          wasmUrl: `${ASSETS}wasm/`,
          iccUrl: `${ASSETS}iccs/`,
        });
        const loaded = await task.promise;
        if (!alive) return;
        const boxes: PageBox[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 });
          boxes.push({ w: vp.width, h: vp.height });
        }
        if (!alive) return;
        finished = true;
        // 옛 문서는 아래 효과가 새 문서로 바뀐 뒤에 닫는다.
        setDoc({ pdf: loaded, boxes, gen: my });
        onDocument?.(loaded, boxes);
      } catch {
        if (alive) onError?.('PDF를 열지 못했어요. 파일이 손상되었거나 암호가 걸려 있을 수 있어요.');
      }
    })();
    return () => {
      alive = false;
      // 다 열지 못한 작업만 여기서 멈춘다. 다 연 문서는 다음 문서로 바꿀 때나 화면을 떠날 때 닫는다.
      if (!finished) void task?.destroy().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  useEffect(() => () => void doc?.pdf.loadingTask.destroy().catch(() => undefined), [doc]);

  useEffect(() => {
    if (!fit) return;
    const el = outer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFitWidth(Math.max(200, el.clientWidth - 32)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const base = fit ? (fitWidth ?? pageWidth) : pageWidth;
  const setRefs = (el: HTMLDivElement | null) => {
    outer.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) (ref as { current: HTMLDivElement | null }).current = el;
  };

  return (
    <div className={className} ref={setRefs}>
      {doc?.boxes.map((box, i) => (
        <LazyPage key={`${doc.gen}-${i}-${zoom}-${base}`} pdf={doc.pdf} index={i} box={box} width={base * zoom} />
      ))}
    </div>
  );
}

function LazyPage({ pdf, index, box, width }: { pdf: PDFDocumentProxy; index: number; box: PageBox; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const height = (box.h / box.w) * width;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || drawn.current) continue;
          drawn.current = true;
          void (async () => {
            try {
              const page = await pdf.getPage(index + 1);
              const dpr = Math.min(window.devicePixelRatio || 1, 2);
              const vp = page.getViewport({ scale: (width / box.w) * dpr });
              canvas.width = Math.floor(vp.width);
              canvas.height = Math.floor(vp.height);
              await page.render({ canvas, viewport: vp }).promise;
            } catch {
              drawn.current = false;
            }
          })();
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(canvas);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} data-page={index} style={{ width, height }} aria-label={`${index + 1}쪽`} />;
}
