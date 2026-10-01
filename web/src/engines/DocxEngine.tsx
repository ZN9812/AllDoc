import { useEffect, useRef, useState } from 'react';
import { SuperDoc } from 'superdoc';
import 'superdoc/style.css';
import { KIND_MIME } from '@alldoc/shared';
import { describeLoadFailure } from './docx/errors';
import { DocxModel, type DocxHost } from './docx/model';
import { TOOLBAR_EXCLUDE, TOOLBAR_STRINGS } from './docx/toolbar';
import type { EngineHandle, EngineProps } from './types';

const DOCX_MIME = KIND_MIME.docx;

/** Word(DOCX): 화면과 편집은 SuperDoc, AI 의 문단·서식 읽기와 고치기는 SuperDoc 의 문서 API 로 한다. */
export default function DocxEngine({ doc, toolsHost, onReady, onDirty, onPages, onError }: EngineProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // 콜백은 매번 새로 만들어지므로, 편집기를 다시 만들지 않도록 최신 것을 따로 들고 있는다.
  const callbacks = useRef({ onReady, onDirty, onError });
  callbacks.current = { onReady, onDirty, onError };

  useEffect(() => {
    onPages(null);
    const mount = mountRef.current;
    if (!toolsHost || !mount) return;

    let alive = true;
    let ready = false;
    let sd: SuperDoc | null = null;

    const toolbar = document.createElement('div');
    toolbar.className = 'docx-toolbar';
    toolsHost.appendChild(toolbar);

    const fail = (message: string) => {
      if (alive) callbacks.current.onError(message);
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
          // AI 변경은 여러 단계로 문서를 고친다. 저장·내려받기·읽기는 진행 중인 변경이 끝난 뒤에 해서 반쯤 바뀐 문서가 나가지 않게 한다.
          let inflight: Promise<unknown> = Promise.resolve();
          const exportDocx = async (): Promise<Blob> => {
            await inflight;
            return rawExport();
          };
          const handle: EngineHandle = {
            kind: 'docx',
            canFormat: true,
            getBlob: exportDocx,
            exportOptions: () => [{ id: 'native', label: 'DOCX', ext: 'docx', run: exportDocx }],
            summarize: async () => {
              await inflight;
              return model.summarize();
            },
            apply: (ops) => {
              const run = inflight.then(async () => {
                setBusy('AI 변경을 적용하는 중…');
                try {
                  const r = await model.apply(ops);
                  if (r.ok) callbacks.current.onDirty();
                  return r;
                } finally {
                  setBusy(null);
                }
              });
              inflight = run.catch(() => undefined);
              return run;
            },
            // Word 문서 위에 겹쳐 표시하는 기능은 아직 없다. 변경 내역 카드로 확인한다.
            setHighlights: () => undefined,
          };
          ready = true;
          callbacks.current.onReady(handle);
        },
        // 편집기는 문서를 열 때나 커서만 옮길 때는 알리지 않고, 글을 고치거나 되돌릴 때(사용자의 편집, 우리의 AI 변경 모두)만 알린다.
        onEditorUpdate: () => {
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
      {busy && (
        <div className="engine-busy" role="status">
          {busy}
        </div>
      )}
    </div>
  );
}
