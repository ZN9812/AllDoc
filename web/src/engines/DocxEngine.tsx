import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { KIND_MIME } from '@alldoc/shared';
import { describeLoadFailure } from './docx/errors';
import { resolveSpans, type Span } from './docx/highlights';
import { createLine } from './docx/line';
import { DocxModel, type BlockLike, type DocxHost } from './docx/model';
import { TOOLBAR_EXCLUDE, TOOLBAR_STRINGS } from './docx/toolbar';
import type { EngineHandle, EngineProps, HighlightState, HighlightTarget } from './types';

const DOCX_MIME = KIND_MIME.docx;

/** Word(DOCX): 화면과 편집은 SuperDoc, AI 의 문단·서식 읽기와 고치기는 SuperDoc 의 문서 API 로 한다. */
export default function DocxEngine({ doc, toolsHost, onReady, onDirty, onPages, onError }: EngineProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 콜백은 매번 새로 만들어지므로, 편집기를 다시 만들지 않도록 최신 것을 따로 들고 있는다.
  const callbacks = useRef({ onReady, onDirty, onError });
  callbacks.current = { onReady, onDirty, onError };

  useEffect(() => {
    onPages(null);
    const mount = mountRef.current;
    const layer = layerRef.current;
    if (!toolsHost || !mount || !layer) return;

    let alive = true;
    let ready = false;
    let sd: SuperDoc | null = null;

    const toolbar = document.createElement('div');
    toolbar.className = 'docx-toolbar';
    toolsHost.appendChild(toolbar);

    const fail = (message: string) => {
      if (alive) callbacks.current.onError(message);
    };

    // ---- AI 가 고칠 곳을 문서 위에 겹쳐 그린다 ----
    // 문단 번호를 글 범위로 바꾸는 데 쓰는 블록 목록. 문서가 바뀌면 비워서 다음에 다시 읽는다.
    let blocks: BlockLike[] | null = null;
    let hl: HighlightState = { pending: [], focus: [] };
    let spans: { pending: Span[]; focus: Span[] } = { pending: [], focus: [] };
    let refreshSeq = 0;
    let off: (() => void) | undefined;

    const paint = () => {
      const ui = sd?.ui;
      if (!ui || !alive) return;
      const origin = layer.getBoundingClientRect();
      const frag = document.createDocumentFragment();
      const draw = (list: Span[], kind: 'pending' | 'focus') => {
        for (const sp of list) {
          const res = ui.viewport.getRect({ target: { kind: 'text', blockId: sp.blockId, range: { start: sp.start, end: sp.end } } });
          // 화면 밖의 쪽은 그려져 있지 않아 찾을 수 없다. 스크롤하면 편집기가 알려 주므로 그때 다시 그린다.
          if (!res.found) continue;
          for (const r of res.rects) {
            const box = document.createElement('div');
            box.className = `docx-hl-box ${kind}`;
            box.style.cssText = `left:${r.left - origin.left}px;top:${r.top - origin.top}px;width:${r.width}px;height:${r.height}px`;
            frag.appendChild(box);
          }
        }
      };
      draw(spans.pending, 'pending');
      draw(spans.focus, 'focus');
      layer.replaceChildren(frag);
    };

    const refresh = async (api: DocxHost['doc']) => {
      const seq = ++refreshSeq;
      if (hl.pending.length === 0 && hl.focus.length === 0) {
        spans = { pending: [], focus: [] };
        paint();
        return;
      }
      try {
        blocks ??= (await api.extract({})).blocks;
      } catch {
        return;
      }
      if (seq !== refreshSeq || !alive || !blocks) return;
      spans = { pending: resolveSpans(hl.pending, blocks), focus: resolveSpans(hl.focus, blocks) };
      paint();
    };

    /** 사용자가 "문서에서 보기"를 눌렀을 때: 그 곳이 화면 가운데 오도록 스크롤한다. */
    const reveal = async (api: DocxHost['doc'], t: HighlightTarget) => {
      try {
        blocks ??= (await api.extract({})).blocks;
        const sp = resolveSpans([t], blocks)[0];
        if (!sp || !alive) return;
        await sd?.ui.viewport.scrollIntoView({ target: { kind: 'text', blockId: sp.blockId, range: { start: sp.start, end: sp.end } }, block: 'center', behavior: 'smooth' });
      } catch {
        // 위치를 보여 주지 못해도 편집에는 영향이 없다.
      }
    };

    try {
      sd = new SuperDoc({
        selector: mount,
        document: new File([doc.blob], doc.name, { type: DOCX_MIME }),
        documentMode: 'editing',
        // 화면이 좁으면(휴대폰) 쪽 너비에 맞춰 줄여 보여 준다. 커지지는 않는다.
        zoom: { mode: 'fit-width', fitWidth: { max: 100, padding: 16 } },
        // 문서를 열 때 SuperDoc 쪽으로 가는 통계 전송을 끈다. 문서 내용은 이 브라우저 밖으로 나가지 않아야 한다.
        telemetry: { enabled: false },
        ui: {
          toolbar: { container: toolbar, excludeItems: [...TOOLBAR_EXCLUDE], strings: TOOLBAR_STRINGS, overflow: 'menu', responsiveTo: 'container' },
          search: true,
          // 댓글은 옆 칸을 만들지 않고 쪽 위에 겹쳐 보인다(옆 칸이 생기면 쪽이 줄어들거나 오른쪽이 잘린다).
          comments: { layout: 'inline' },
        },
        onReady: ({ superdoc }) => {
          if (!alive) return;
          const api = superdoc.activeEditor?.doc as unknown as DocxHost['doc'] | undefined;
          if (!api) {
            fail('Word 편집기가 문서를 열었지만 편집 기능을 시작하지 못했어요.');
            return;
          }
          const rawExport = async (): Promise<Blob> => {
            const blob = await superdoc.export({ exportType: ['docx'], triggerDownload: false });
            return new Blob([blob], { type: DOCX_MIME });
          };
          const model = new DocxModel({ doc: api, exportDocx: rawExport });
          // 편집기에 대한 내보내기·읽기·변경을 한 줄로 세워 서로 겹치지 않게 한다.
          // 편집기는 파일로 내보내는 동안 변경을 거절한다("읽기 전용 검토 모드" 오류). 그래서 자동 저장과 AI 변경이 겹치면 변경이 실패한다.
          // 또 AI 변경은 여러 단계로 문서를 고치므로, 반쯤 바뀐 문서가 저장되거나 내려받아지는 것도 막는다.
          // (model 안에서는 줄을 거치지 않는 rawExport 를 쓴다. 줄 안에서 줄을 다시 기다리면 영영 끝나지 않는다.)
          const inLine = createLine();
          const exportDocx = (): Promise<Blob> => inLine(rawExport);
          const handle: EngineHandle = {
            kind: 'docx',
            canFormat: true,
            getBlob: exportDocx,
            exportOptions: () => [{ id: 'native', label: 'DOCX', ext: 'docx', run: exportDocx }],
            summarize: () => inLine(() => model.summarize()),
            apply: (ops) =>
              inLine(async () => {
                setBusy('AI 변경을 적용하는 중…');
                try {
                  const r = await model.apply(ops);
                  blocks = null;
                  if (r.ok) callbacks.current.onDirty();
                  return r;
                } finally {
                  setBusy(null);
                }
              }),
            setHighlights: (state) => {
              hl = state;
              void refresh(api);
            },
            reveal: (t) => void reveal(api, t),
          };
          // 쪽이 그려지거나 스크롤·확대·다시 배치가 있을 때마다 편집기가 알려 준다 → 고칠 곳을 다시 그린다.
          off = superdoc.ui.viewport.observe(paint);
          ready = true;
          callbacks.current.onReady(handle);
        },
        // 편집기는 문서를 열 때나 커서만 옮길 때는 알리지 않고, 글을 고치거나 되돌릴 때(사용자의 편집, 우리의 AI 변경 모두)만 알린다.
        onEditorUpdate: () => {
          blocks = null; // 문단이 달라졌을 수 있다.
          if (alive && ready) callbacks.current.onDirty();
        },
        onException: (e) => {
          console.warn('[Word 편집기]', e);
          const message = ready ? null : describeLoadFailure(e);
          if (message) fail(message);
        },
        onContentError: ({ error }) => {
          fail(`문서를 읽는 중 문제가 생겼어요: ${error instanceof Error ? error.message : String(error)}`);
        },
      });
    } catch (e) {
      fail(`Word 편집기를 열지 못했어요: ${e instanceof Error ? e.message : String(e)}`);
    }

    return () => {
      alive = false;
      off?.();
      layer.replaceChildren();
      try {
        sd?.destroy();
      } catch (e) {
        console.warn('Word 편집기를 닫는 중 문제가 생겼어요', e);
      }
      sd = null;
      toolbar.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, toolsHost]);

  return (
    <div className="docx-engine">
      {/* AI 변경을 적용하는 동안에는 편집기에 입력이 들어가지 않게 막는다(마우스는 위의 막으로, 키보드는 inert 로). */}
      <div className="docx-mount" ref={mountRef} inert={busy !== null} />
      {/* AI 가 고칠 곳을 표시하는 막(문서 내용과 함께 스크롤된다). 마우스 입력은 받지 않는다. */}
      <div className="docx-hl" ref={layerRef} aria-hidden="true" />
      {busy && (
        <div className="engine-busy" role="status">
          {busy}
        </div>
      )}
    </div>
  );
}
