import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import TopBar, { type SaveState } from '../components/TopBar';
import EngineBoundary, { EngineFailure } from '../editor/EngineBoundary';
import MobileBar from '../editor/MobileBar';
import PagesList from '../editor/PagesList';
import SidePanel from '../editor/SidePanel';
import { useEditor } from '../editor/store';
import { engineFor } from '../engines/registry';
import type { EngineHandle, LoadedDoc, PagesApi } from '../engines/types';
import { getDoc, isQuotaError, saveWorking, touchOpened } from '../lib/docs';
import { useTitle } from '../lib/useTitle';
import { toast } from '../state/toast';

/** 마지막으로 고친 뒤 이 시간이 지나면 이 브라우저에 저장한다. */
const AUTOSAVE_MS = 800;

type Load = { status: 'loading' } | { status: 'missing' } | { status: 'ready'; doc: LoadedDoc; edited: boolean; updatedAt: number };

export default function EditorPage({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [toolsHost, setToolsHost] = useState<HTMLElement | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [edited, setEdited] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: 'saved', at: Date.now() });
  const sheetOpen = useEditor((s) => s.sheetOpen);

  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const chain = useRef<Promise<void>>(Promise.resolve());

  useTitle(load.status === 'ready' ? load.doc.name : undefined);

  // 문서를 이 브라우저 저장소에서 불러온다.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stored = await getDoc(id);
        if (!alive) return;
        if (!stored) {
          setLoad({ status: 'missing' });
          return;
        }
        void touchOpened(id);
        setEdited(stored.meta.edited);
        setSave({ kind: 'saved', at: stored.meta.updatedAt });
        setLoad({
          status: 'ready',
          doc: { id: stored.meta.id, name: stored.meta.name, kind: stored.meta.kind, blob: stored.working },
          edited: stored.meta.edited,
          updatedAt: stored.meta.updatedAt,
        });
      } catch {
        if (alive) setLoad({ status: 'missing' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  /** 지금 상태를 저장한다. 엔진이 닫힌 뒤에도 저장되도록 파일은 부르는 즉시 받아 둔다. */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return chain.current;
    const engine = useEditor.getState().engine;
    if (!engine) return chain.current;
    dirty.current = false;
    const pending = engine.getBlob();
    pending.catch(() => undefined);
    const run = chain.current.then(async () => {
      setSave({ kind: 'saving' });
      try {
        const meta = await saveWorking(id, await pending);
        setSave({ kind: 'saved', at: meta.updatedAt });
        void engine.markSaved?.().catch(() => undefined);
      } catch (e) {
        dirty.current = true;
        setSave({ kind: 'error' });
        toast(isQuotaError(e) ? '이 브라우저의 저장 공간이 부족해서 저장하지 못했어요. 내려받아 따로 보관해 주세요.' : '자동 저장에 실패했어요. 내려받아 따로 보관해 주세요.', 'error');
      }
    });
    chain.current = run;
    return run;
  }, [id]);

  const onDirty = useCallback(() => {
    dirty.current = true;
    setEdited(true);
    setSave((s) => (s.kind === 'saving' ? s : { kind: 'saving' }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  const onReady = useCallback((h: EngineHandle) => useEditor.getState().setEngine(h), []);
  const onPages = useCallback((p: PagesApi | null) => useEditor.getState().setPages(p), []);

  // 탭을 닫거나 숨길 때, 화면을 떠날 때 마지막 변경을 저장한다.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditor.getState().closeSheet();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('keydown', onKey);
      void flush();
      useEditor.getState().reset();
    };
  }, [flush]);

  if (load.status === 'loading') {
    return (
      <div className="shell">
        <TopBar mode="editor" name="" edited={false} save={save} />
        <div className="engine-loading">문서를 불러오는 중…</div>
      </div>
    );
  }

  if (load.status === 'missing') {
    return (
      <div className="shell">
        <TopBar mode="home" showSearch={false} />
        <div className="engine-error" role="alert">
          <p>이 브라우저에서 문서를 찾을 수 없어요. 지웠거나, 다른 기기·다른 브라우저에서 올린 문서일 수 있어요.</p>
          <Link className="btn primary" to="/">
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  const { doc } = load;
  const Engine = engineFor(doc.kind);
  const bare = doc.kind === 'hwp' || doc.kind === 'hwpx' || doc.kind === 'docx';

  return (
    <div className="shell">
      <TopBar mode="editor" name={doc.name} edited={edited} save={save} />
      <div className="editor">
        <div className="tools" ref={setToolsHost} role="toolbar" aria-label="편집 도구" />
        <div className="ebody">
          <PagesList />
          <main className={`canvas${bare ? ' bare' : ''}`} data-sheet={sheetOpen ? 'open' : undefined}>
            {engineError ? (
              <EngineFailure message={engineError} />
            ) : (
              <EngineBoundary>
                <Suspense fallback={<div className="engine-loading">편집기를 불러오는 중…</div>}>
                  <Engine doc={doc} toolsHost={toolsHost} onReady={onReady} onDirty={onDirty} onPages={onPages} onError={setEngineError} />
                </Suspense>
              </EngineBoundary>
            )}
          </main>
          <SidePanel kind={doc.kind} />
        </div>
        <MobileBar />
      </div>
    </div>
  );
}
