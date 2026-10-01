import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// 오래된 브라우저(기관 PC 등)에서도 열리도록 pdf.js 의 호환(legacy) 빌드를 쓴다.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { blobToBytes } from '../lib/files';
import { unsupported } from './applyOps';
import type { EngineHandle, EngineProps, PagesApi } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

interface PageBox {
  w: number;
  h: number;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;

/** PDF 는 보기만 한다(글 수정 없음). 보이는 쪽만 그려서 큰 문서도 가볍게 연다. */
export default function PdfEngine({ doc, toolsHost, onReady, onPages, onError }: EngineProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [boxes, setBoxes] = useState<PageBox[]>([]);
  const [zoom, setZoom] = useState(1);
  const hostRef = useRef<HTMLDivElement>(null);
  const thumbs = useRef(new Map<number, string>());
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    let alive = true;
    let task: PDFDocumentLoadingTask | null = null;
    (async () => {
      try {
        const bytes = await blobToBytes(doc.blob);
        task = pdfjs.getDocument({
          data: bytes,
          // 글꼴이 들어 있지 않은 한글 PDF와 특수 이미지를 그리는 보조 파일(빌드 때 public/pdfjs 로 복사됨)
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          wasmUrl: `${ASSETS}wasm/`,
          iccUrl: `${ASSETS}iccs/`,
        });
        const loaded = await task.promise;
        if (!alive) return;
        const sizes: PageBox[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const page = await loaded.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        if (!alive) return;
        setBoxes(sizes);
        setPdf(loaded);
      } catch {
        if (alive) onError('PDF를 열지 못했어요. 파일이 손상되었거나 암호가 걸려 있을 수 있어요.');
      }
    })();
    return () => {
      alive = false;
      void task?.destroy();
      thumbs.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  useEffect(() => {
    if (!pdf) return;
    const handle: EngineHandle = {
      kind: 'pdf',
      canFormat: false,
      getBlob: async () => doc.blob,
      exportOptions: () => [{ id: 'native', label: 'PDF', ext: 'pdf', run: async () => doc.blob }],
      summarize: async () => ({ kind: 'pdf', paragraphs: [], pageCount: pdf.numPages }),
      apply: async () => unsupported('PDF는 글을 고칠 수 없어요.'),
      setHighlights: () => undefined,
    };
    onReady(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf]);

  // 지금 보고 있는 쪽 = 화면에 가장 많이 보이는 쪽
  useEffect(() => {
    const host = hostRef.current;
    if (!pdf || !host) return;
    const ratios = new Map<number, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(Number((e.target as HTMLElement).dataset.page), e.isIntersecting ? e.intersectionRatio : 0);
        let best = -1;
        let bestRatio = 0;
        for (const [i, r] of ratios) {
          if (r > bestRatio || (r === bestRatio && r > 0 && i < best)) {
            best = i;
            bestRatio = r;
          }
        }
        if (best >= 0) setCurrent(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    host.querySelectorAll('canvas').forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [pdf, boxes, zoom]);

  // 쪽 목록: 작은 그림은 따로 작게 그려서 만든다.
  useEffect(() => {
    if (!pdf) return;
    const api: PagesApi = {
      count: pdf.numPages,
      current,
      thumb: async (index) => {
        const cached = thumbs.current.get(index);
        if (cached) return cached;
        const page = await pdf.getPage(index + 1);
        const vp = page.getViewport({ scale: 176 / page.getViewport({ scale: 1 }).width });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        await page.render({ canvas: c, viewport: vp }).promise;
        const url = c.toDataURL('image/jpeg', 0.7);
        thumbs.current.set(index, url);
        return url;
      },
      goTo: (index) => {
        setCurrent(index);
        hostRef.current?.querySelectorAll('canvas')[index]?.scrollIntoView({ block: 'start' });
      },
    };
    onPages(api);
    return () => onPages(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, current]);

  if (!pdf) return <div className="engine-loading">PDF를 여는 중…</div>;

  const tools = toolsHost
    ? createPortal(
        <>
          <button type="button" className="tb" aria-label="축소" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))}>
            −
          </button>
          <span className="tnote" style={{ margin: '0 6px' }}>
            {Math.round(zoom * 100)}%
          </span>
          <button type="button" className="tb" aria-label="확대" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))}>
            +
          </button>
          <span className="tsep" />
          <span className="tnote">PDF는 보기만 할 수 있어요 · {pdf.numPages}쪽</span>
        </>,
        toolsHost,
      )
    : null;

  return (
    <>
      {tools}
      <div className="pdf-engine" ref={hostRef}>
        {boxes.map((box, i) => (
          <LazyPage key={`${i}-${zoom}`} pdf={pdf} index={i} box={box} zoom={zoom} />
        ))}
      </div>
    </>
  );
}

function LazyPage({
  pdf,
  index,
  box,
  zoom,
}: {
  pdf: PDFDocumentProxy;
  index: number;
  box: PageBox;
  zoom: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef(false);
  const width = Math.min(900, 820) * zoom;
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
