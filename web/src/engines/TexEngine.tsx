import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { isTexSource, isTextFile, normalizeProjectPath, slotOf, TEX_ENGINE_LABEL, TEX_ENGINES, type Op, type TexEngine as Engine } from '@alldoc/shared';
import { loginUrl } from '../ai/client';
import { useEditor } from '../editor/store';
import { compileProject } from '../editor/tex/compile';
import { diagnosticsFor, isBusy, statusText, useTex } from '../editor/tex/store';
import { getDoc, isQuotaError, listTexFiles, updateTexFiles, type TexFileRecord, type TexProjectMeta } from '../lib/docs';
import { formatBytes } from '../lib/files';
import { exportZip, sha256Hex } from '../lib/texProject';
import { compileAvailability, useAuth } from '../state/auth';
import { useSettings } from '../state/settings';
import { useTerms } from '../state/terms';
import { toast } from '../state/toast';
import { applyAtomic, stale, type OneResult } from './applyOps';
import PdfView from './pdf/PdfView';
import { EditorState, EditorView, goToLine, selectedLines, selectRange, showAiMarks, showDiagnostics, texExtensions, type AiMark } from './tex/cm';
import { applyTexOp, rangeOfTarget, SlotTable, summarizeProject, type ProjectText } from './tex/model';
import type { EngineHandle, EngineProps, ExportOption, HighlightState, HighlightTarget, SummarizeOptions } from './types';

type Pane = 'files' | 'source' | 'pdf';

interface FileEntry {
  path: string;
  blob: Blob;
  hash: string;
}

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

/**
 * LaTeX 프로젝트: 왼쪽 파일 목록 | 가운데 원고(CodeMirror) | 오른쪽 PDF 미리보기. 휴대폰에서는 셋 중 하나를 골라 본다.
 * 파일은 파일별로 이 브라우저에 저장하고(바뀐 파일만), 컴파일할 때만 서버로 보낸다.
 */
export default function TexEngine({ doc, toolsHost, onReady, onDirty, onPages, onError }: EngineProps) {
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [project, setProject] = useState<TexProjectMeta | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('source');
  const [zoom, setZoom] = useState(1);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const [, tick] = useState(0);

  const tex = useTex();
  const me = useAuth((s) => s.me);

  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** 파일별 편집 상태(되돌리기 기록 포함)와 고친 횟수 */
  const states = useRef(new Map<string, EditorState>());
  const versions = useRef(new Map<string, number>());
  const saved = useRef(new Map<string, number>());
  const filesRef = useRef<FileEntry[]>([]);
  const projectRef = useRef<TexProjectMeta | null>(null);
  const openRef = useRef<string | null>(null);
  /** 지금 편집기에 붙어 있는 파일(파일을 바꾸는 동안에는 open 과 다를 수 있다) */
  const attached = useRef<string | null>(null);
  /** 파일을 연 뒤에 옮겨 갈 줄 */
  const pendingJump = useRef<{ file: string; line: number } | null>(null);
  const compileRef = useRef<() => void>(() => undefined);
  const noticeDialog = useRef<HTMLDialogElement>(null);
  const noticeResolve = useRef<((ok: boolean) => void) | null>(null);
  /** AI 블록 번호의 파일칸(프로젝트를 열 때 정한다, docs/LATEX.md) */
  const slots = useRef(new SlotTable());
  /** 마지막으로 받은 AI 표시(파일을 바꾸면 그 파일 것을 다시 그린다) */
  const highlights = useRef<HighlightState>({ pending: [], focus: [] });
  /** 파일을 연 뒤에 보여 줄 AI 제안 자리 */
  const pendingReveal = useRef<HighlightTarget | null>(null);

  filesRef.current = files ?? [];
  projectRef.current = project;
  openRef.current = open;

  // ---- 불러오기 ----
  useEffect(() => {
    onPages(null);
    useTex.getState().reset();
    // LaTeX 프로젝트는 컴파일 탭으로 시작한다.
    useEditor.getState().setTab('compile');
    let alive = true;
    (async () => {
      try {
        const [stored, records] = await Promise.all([getDoc(doc.id), listTexFiles(doc.id)]);
        if (!alive) return;
        const proj = stored?.meta.project;
        if (!proj || records.length === 0) {
          onError('LaTeX 프로젝트를 읽지 못했어요.');
          return;
        }
        slots.current = new SlotTable(records.map((r) => r.path));
        setFiles(records.map((r: TexFileRecord) => ({ path: r.path, blob: r.blob, hash: r.hash })));
        setProject(proj);
        setOpen(records.some((r) => r.path === proj.main) ? proj.main : (records.find((r) => isTextFile(r.path))?.path ?? null));
      } catch {
        if (alive) onError('LaTeX 프로젝트를 읽지 못했어요.');
      }
    })();
    return () => {
      alive = false;
      view.current?.destroy();
      view.current = null;
      useTex.getState().reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const markChanged = useCallback(
    (path: string) => {
      versions.current.set(path, (versions.current.get(path) ?? 0) + 1);
      onDirty();
    },
    [onDirty],
  );

  const stateFor = useCallback(
    async (path: string): Promise<EditorState | null> => {
      const cached = states.current.get(path);
      if (cached) return cached;
      const f = filesRef.current.find((x) => x.path === path);
      if (!f || !isTextFile(path)) return null;
      const st = EditorState.create({
        doc: await f.blob.text(),
        extensions: texExtensions(`${path} 원고`, { onChange: () => markChanged(path), onCompile: () => compileRef.current() }),
      });
      states.current.set(path, st);
      return st;
    },
    [markChanged],
  );

  // ---- AI: 요약·적용·표시 ----
  const mainPath = (): string => projectRef.current?.main ?? '';

  /** 지금 글(편집기에 붙은 파일은 편집기의 글, 연 적 있는 파일은 보관한 상태, 나머지는 저장본) */
  const textOf = useCallback(async (path: string): Promise<string | null> => {
    if (attached.current === path && view.current) return view.current.state.doc.toString();
    const st = states.current.get(path);
    if (st) return st.doc.toString();
    const f = filesRef.current.find((x) => x.path === path);
    return f && isTextFile(path) ? f.blob.text() : null;
  }, []);

  const isAiFile = (path: string): boolean => /\.(tex|ltx|bib)$/i.test(path);

  const summarize = useCallback(
    async (opts: SummarizeOptions = {}) => {
      const cur = attached.current ?? openRef.current;
      let paths: string[];
      let onlyLines: { path: string; from: number; to: number } | undefined;
      // 주 파일은 늘 함께 보낸다(서문을 고칠 수 있게).
      if (opts.files) paths = [...new Set([mainPath(), ...opts.files])];
      else if (opts.scope === 'project') paths = filesRef.current.map((f) => f.path);
      else {
        paths = cur ? [cur] : [];
        if (opts.scope === 'selection' && cur && view.current && attached.current === cur) onlyLines = { path: cur, ...selectedLines(view.current.state) };
      }
      const texts: ProjectText[] = [];
      for (const p of paths.filter(isAiFile)) {
        const text = await textOf(p);
        if (text !== null) texts.push({ path: p, text });
      }
      return summarizeProject(texts, slots.current, mainPath(), onlyLines);
    },
    [textOf],
  );

  /** 지금 편집기에 붙은 파일 위에 AI 표시를 그린다. */
  const drawMarks = useCallback(() => {
    const v = view.current;
    const path = attached.current;
    if (!v || !path) return;
    const slot = slots.current.slotFor(path);
    const f = { path, text: v.state.doc.toString() };
    const marks: AiMark[] = [];
    const add = (ts: HighlightTarget[], focus: boolean) => {
      // 같은 블록의 같은 글을 가리키는 표시는 차례로 다음 자리에 그린다.
      const seen = new Map<string, number>();
      for (const t of ts) {
        if (slotOf(t.paragraph) !== slot) continue;
        const key = `${t.paragraph}\u0000${t.find ?? ''}`;
        const nth = seen.get(key) ?? 0;
        seen.set(key, nth + 1);
        const r = rangeOfTarget(f, slot, mainPath(), t, nth);
        if (r) marks.push({ from: r[0], to: r[1], focus });
      }
    };
    add(highlights.current.pending, false);
    add(highlights.current.focus, true);
    showAiMarks(v, marks);
  }, []);

  const revealHere = useCallback((t: HighlightTarget) => {
    const v = view.current;
    const path = attached.current;
    if (!v || !path) return;
    const slot = slots.current.slotFor(path);
    const r = rangeOfTarget({ path, text: v.state.doc.toString() }, slot, mainPath(), t) ?? rangeOfTarget({ path, text: v.state.doc.toString() }, slot, mainPath(), { paragraph: t.paragraph });
    if (r) selectRange(v, r[0], r[1]);
    else toast('원고가 바뀌어 그 자리를 찾지 못했어요.');
  }, []);

  const reveal = useCallback(
    (t: HighlightTarget) => {
      const path = slots.current.pathOf(slotOf(t.paragraph));
      if (!path || !filesRef.current.some((f) => f.path === path)) {
        toast('그 파일이 프로젝트에 없어요.');
        return;
      }
      setPane('source');
      if (attached.current === path && view.current) {
        revealHere(t);
        return;
      }
      pendingReveal.current = t;
      setOpen(path);
    },
    [revealHere],
  );

  /** 변경 하나를 그 파일의 편집 상태에 적용한다(편집기에 붙은 파일이면 편집기에, 아니면 보관한 상태에). */
  const applyOne = useCallback(
    async (op: Op): Promise<OneResult> => {
      const path = slots.current.pathOf(slotOf(op.paragraph));
      if (!path || !isAiFile(path) || !filesRef.current.some((f) => f.path === path)) return stale('제안을 만든 뒤 파일 이름이 바뀌었거나 파일이 지워졌어요.');
      const live = attached.current === path && view.current ? view.current : null;
      const st = live ? live.state : await stateFor(path);
      if (!st) return stale('파일을 읽지 못했어요.');
      const r = applyTexOp({ path, text: st.doc.toString() }, slots.current.slotFor(path), mainPath(), op);
      if (!r.ok) return r;
      const changes = { from: r.from, to: r.to, insert: r.insert };
      if (live) live.dispatch({ changes, userEvent: 'input.ai' });
      else {
        states.current.set(path, st.update({ changes }).state);
        markChanged(path);
      }
      return { ok: true, inverse: r.inverse };
    },
    [stateFor, markChanged],
  );

  // ---- 연 파일을 편집기에 붙이기 ----
  useEffect(() => {
    const path = open;
    if (!path || !host.current) return;
    let alive = true;
    void (async () => {
      const st = await stateFor(path);
      if (!alive || !st || !host.current) return;
      if (!view.current) view.current = new EditorView({ state: st, parent: host.current });
      else view.current.setState(st);
      attached.current = path;
      showDiagnostics(view.current, diagnosticsFor(useTex.getState().result?.diagnostics ?? [], path));
      drawMarks();
      const j = pendingJump.current;
      if (j && j.file === path) {
        pendingJump.current = null;
        goToLine(view.current, j.line);
      }
      const r = pendingReveal.current;
      if (r && slots.current.pathOf(slotOf(r.paragraph)) === path) {
        pendingReveal.current = null;
        revealHere(r);
      }
    })();
    return () => {
      alive = false;
      // 다른 파일로 바꾸기 전에 지금 상태(되돌리기 기록 포함)를 그 파일 이름으로 보관한다.
      if (view.current && attached.current === path) {
        states.current.set(path, view.current.state);
        attached.current = null;
      }
    };
  }, [open, stateFor, files === null]);

  /** 편집 중인 글을 포함한 지금 파일 목록(내용 해시까지 맞춘 것)을 만들고 바뀐 파일을 저장한다. */
  const persist = useCallback(async (): Promise<{ updatedAt: number }> => {
    if (view.current && attached.current) states.current.set(attached.current, view.current.state);
    // 부르는 즉시 저장할 글을 잡아 둔다.
    const pending: Array<{ path: string; text: string; version: number }> = [];
    for (const [path, v] of versions.current) {
      if ((saved.current.get(path) ?? 0) === v) continue;
      const st = states.current.get(path);
      if (st) pending.push({ path, text: st.doc.toString(), version: v });
    }
    if (pending.length === 0) return { updatedAt: Date.now() };
    const upsert = await Promise.all(
      pending.map(async (p) => {
        const blob = new Blob([p.text], { type: 'text/plain;charset=utf-8' });
        return { path: p.path, blob, hash: await sha256Hex(blob) };
      }),
    );
    const meta = await updateTexFiles(doc.id, { upsert });
    for (const p of pending) saved.current.set(p.path, p.version);
    const byPath = new Map(upsert.map((u) => [u.path, u]));
    setFiles((cur) => (cur ?? []).map((f) => byPath.get(f.path) ?? f));
    filesRef.current = filesRef.current.map((f) => byPath.get(f.path) ?? f);
    return { updatedAt: meta.updatedAt };
  }, [doc.id]);

  const changeProject = useCallback(
    async (patch: Partial<TexProjectMeta>) => {
      try {
        const meta = await updateTexFiles(doc.id, { project: patch });
        setProject(meta.project ?? null);
        onDirty();
      } catch {
        toast('프로젝트 설정을 저장하지 못했어요.', 'error');
      }
    },
    [doc.id, onDirty],
  );

  // ---- 컴파일 ----
  const askNotice = useCallback((): Promise<boolean> => {
    if (useSettings.getState().compileNoticeAt) return Promise.resolve(true);
    setNotice(true);
    return new Promise((resolve) => {
      noticeResolve.current = resolve;
    });
  }, []);

  const compile = useCallback(async () => {
    const st = useTex.getState();
    if (isBusy(st.phase) || !projectRef.current) return;
    const avail = compileAvailability(useAuth.getState().me);
    if (!avail.ok) {
      toast(avail.message, 'error');
      if (avail.reason === 'agreement') useTerms.getState().show();
      return;
    }
    if (!(await askNotice())) return;
    try {
      await persist();
    } catch (e) {
      toast(isQuotaError(e) ? '이 브라우저의 저장 공간이 부족해서 저장하지 못했어요.' : '저장하지 못해 컴파일을 멈췄어요.', 'error');
      return;
    }
    const proj = projectRef.current;
    st.start();
    try {
      const out = await compileProject(
        { files: filesRef.current, main: proj.main, engine: proj.engine },
        { onUpload: (d, t) => useTex.getState().setUpload(d, t), onCompiling: () => useTex.getState().setCompiling() },
      );
      useTex.getState().finish(out.response, out.pdf);
      useTex.getState().checkRegression(
        useEditor
          .getState()
          .items.filter((i) => i.status === 'applied')
          .map((i) => i.proposal.id),
      );
      const cur = attached.current;
      if (view.current && cur) showDiagnostics(view.current, diagnosticsFor(out.response.diagnostics, cur));
      if (out.response.status !== 'ok') useEditor.getState().setTab('compile');
      void useAuth.getState().refresh();
    } catch (e) {
      useTex.getState().fail(e instanceof Error ? e.message : '컴파일하지 못했어요.');
    }
  }, [askNotice, persist]);
  compileRef.current = () => void compile();

  useEffect(() => {
    useTex.getState().setCompile(() => void compileRef.current());
    return () => useTex.getState().setCompile(null);
  }, []);

  // 컴파일 중에는 경과 시간을 1초마다 다시 그린다.
  useEffect(() => {
    if (!isBusy(tex.phase)) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [tex.phase]);

  // 오류를 누르면 그 파일·줄로 간다.
  useEffect(() => {
    const j = tex.jump;
    if (!j) return;
    if (!filesRef.current.some((f) => f.path === j.file)) {
      toast(`프로젝트에 없는 파일이에요(${j.file}).`);
      return;
    }
    setPane('source');
    if (attached.current === j.file && view.current) {
      goToLine(view.current, j.line);
      return;
    }
    // 파일을 붙인 뒤에 옮긴다(붙이는 효과가 처리한다).
    pendingJump.current = { file: j.file, line: j.line };
    setOpen(j.file);
  }, [tex.jump]);

  // ---- 편집기 연결부 ----
  const ready = files !== null && project !== null;
  useEffect(() => {
    if (!ready) return;
    const zipNow = async () => {
      await persist();
      return exportZip(filesRef.current);
    };
    const handle: EngineHandle = {
      kind: 'tex',
      canFormat: false,
      getBlob: zipNow,
      persist,
      exportOptions: () => {
        const cur = openRef.current;
        const opts: ExportOption[] = [{ id: 'zip', label: '프로젝트 ZIP', ext: 'zip', run: zipNow }];
        if (cur && isTexSource(cur)) {
          opts.push({
            id: 'tex',
            label: `지금 연 파일(${cur.split('/').pop()})`,
            ext: 'tex',
            run: async () => {
              await persist();
              return filesRef.current.find((f) => f.path === cur)?.blob ?? new Blob([]);
            },
          });
        }
        const pdf = useTex.getState().pdf;
        if (pdf) opts.push({ id: 'pdf', label: '마지막으로 만든 PDF', ext: 'pdf', run: async () => new Blob([pdf.slice() as BlobPart], { type: 'application/pdf' }) });
        return opts;
      },
      summarize,
      apply: async (ops) => {
        const r = await applyAtomic(applyOne, ops);
        drawMarks();
        return r;
      },
      setHighlights: (state) => {
        highlights.current = state;
        drawMarks();
      },
      reveal,
    };
    onReady(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, persist, summarize, applyOne, drawMarks, reveal]);

  // ---- 파일 다루기 ----
  const addFiles = async (entries: Array<{ path: string; blob: Blob }>) => {
    try {
      const upsert = await Promise.all(entries.map(async (e) => ({ path: e.path, blob: e.blob, hash: await sha256Hex(e.blob) })));
      await updateTexFiles(doc.id, { upsert });
      for (const u of upsert) {
        states.current.delete(u.path);
        // 같은 이름으로 새로 올린 파일은 다른 글이다: 새 파일칸을 받는다.
        slots.current.forget(u.path);
        slots.current.slotFor(u.path);
      }
      setFiles((cur) => {
        const map = new Map((cur ?? []).map((f) => [f.path, f]));
        for (const u of upsert) map.set(u.path, u);
        return [...map.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
      });
      onDirty();
      return true;
    } catch (e) {
      toast(isQuotaError(e) ? '이 브라우저의 저장 공간이 부족해요.' : '파일을 저장하지 못했어요.', 'error');
      return false;
    }
  };

  const validNewPath = (raw: string, except?: string): string | null => {
    const p = normalizeProjectPath(raw.trim());
    if (!p) {
      toast('쓸 수 없는 파일 이름이에요. "..", 맨 앞의 "/", 너무 긴 이름은 쓸 수 없어요.', 'error');
      return null;
    }
    if (p !== except && filesRef.current.some((f) => f.path === p)) {
      toast('같은 이름의 파일이 이미 있어요.', 'error');
      return null;
    }
    return p;
  };

  const onAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = new FormData(e.currentTarget).get('name');
    const p = validNewPath(String(input ?? ''));
    if (!p) return;
    if (await addFiles([{ path: p, blob: new Blob([''], { type: 'text/plain;charset=utf-8' }) }])) {
      setAdding(false);
      if (isTextFile(p)) setOpen(p);
    }
  };

  const onRename = async (e: FormEvent<HTMLFormElement>, from: string) => {
    e.preventDefault();
    const to = validNewPath(String(new FormData(e.currentTarget).get('name') ?? ''), from);
    if (!to) return;
    if (to === from) {
      setRenaming(null);
      return;
    }
    await persist().catch(() => undefined);
    const f = filesRef.current.find((x) => x.path === from);
    if (!f) return;
    try {
      const isMain = projectRef.current?.main === from;
      const meta = await updateTexFiles(doc.id, { upsert: [{ ...f, path: to }], remove: [from], project: isMain ? { main: to } : undefined });
      // 편집기에 붙어 있는 상태가 가장 새것이다. 옛 이름으로 다시 보관되지 않게 붙은 파일 이름도 바꾼다.
      const st = attached.current === from && view.current ? view.current.state : states.current.get(from);
      states.current.delete(from);
      if (st) states.current.set(to, st);
      // 이름을 바꾸면 새 파일칸을 받는다(옛 이름을 가리키던 제안은 낡은 것이 된다).
      slots.current.forget(from);
      slots.current.slotFor(to);
      if (attached.current === from) attached.current = to;
      for (const m of [versions.current, saved.current]) {
        const v = m.get(from);
        m.delete(from);
        if (v !== undefined) m.set(to, v);
      }
      setFiles((cur) => (cur ?? []).map((x) => (x.path === from ? { ...x, path: to } : x)).sort((a, b) => (a.path < b.path ? -1 : 1)));
      setProject(meta.project ?? null);
      if (openRef.current === from) setOpen(to);
      setRenaming(null);
      onDirty();
    } catch {
      toast('이름을 바꾸지 못했어요.', 'error');
    }
  };

  const onDelete = async (path: string) => {
    if (projectRef.current?.main === path) {
      toast('주 파일은 지울 수 없어요. 다른 파일을 주 파일로 정한 뒤 지워 주세요.', 'error');
      return;
    }
    if (!window.confirm(`${path} 파일을 지울까요? 되돌릴 수 없어요.`)) return;
    try {
      await updateTexFiles(doc.id, { remove: [path] });
      if (attached.current === path) attached.current = null;
      states.current.delete(path);
      slots.current.forget(path);
      versions.current.delete(path);
      saved.current.delete(path);
      setFiles((cur) => (cur ?? []).filter((f) => f.path !== path));
      if (openRef.current === path) setOpen(projectRef.current?.main ?? null);
      onDirty();
    } catch {
      toast('파일을 지우지 못했어요.', 'error');
    }
  };

  const onUpload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const entries: Array<{ path: string; blob: Blob }> = [];
    for (const f of Array.from(list)) {
      const p = normalizeProjectPath(f.name);
      if (!p) {
        toast(`쓸 수 없는 파일 이름이에요: ${f.name}`, 'error');
        continue;
      }
      entries.push({ path: p, blob: f });
    }
    if (entries.length > 0 && (await addFiles(entries))) toast(`${entries.length}개 파일을 넣었어요.`);
  };

  const onNoticeAnswer = (ok: boolean) => {
    if (ok) useSettings.getState().ackCompileNotice();
    setNotice(false);
    noticeResolve.current?.(ok);
    noticeResolve.current = null;
  };

  useEffect(() => {
    const d = noticeDialog.current;
    if (!d) return;
    if (notice && !d.open) d.showModal();
    if (!notice && d.open) d.close();
  }, [notice]);

  const counts = useMemo(() => {
    const ds = tex.result?.diagnostics ?? [];
    const m = new Map<string, number>();
    for (const d of ds) if (d.severity === 'error' && d.file) m.set(d.file, (m.get(d.file) ?? 0) + 1);
    return m;
  }, [tex.result]);

  if (!files || !project) return <div className="engine-loading">프로젝트를 여는 중…</div>;

  const busy = isBusy(tex.phase);
  const elapsed = tex.startedAt ? Math.floor((Date.now() - tex.startedAt) / 1000) : 0;
  const status = statusText(tex, elapsed);
  const texFiles = files.filter((f) => isTexSource(f.path));
  const avail = compileAvailability(me);
  const openFile = open ? files.find((f) => f.path === open) : undefined;

  const tools = toolsHost
    ? createPortal(
        <>
          <button type="button" className="tb primary-tb" onClick={() => void compile()} disabled={busy} title="Ctrl+S 또는 Ctrl+Enter">
            {busy ? '컴파일 중…' : '컴파일'}
          </button>
          <span className="tsep" />
          <label className="tsel">
            <span className="sr-only">엔진</span>
            <select aria-label="엔진" value={project.engine} onChange={(e) => void changeProject({ engine: e.target.value as Engine })} disabled={busy}>
              {TEX_ENGINES.map((en) => (
                <option key={en} value={en}>
                  {TEX_ENGINE_LABEL[en]}
                </option>
              ))}
            </select>
          </label>
          <label className="tsel">
            <span className="sr-only">주 파일</span>
            <select aria-label="주 파일" value={project.main} onChange={(e) => void changeProject({ main: e.target.value })} disabled={busy}>
              {texFiles.map((f) => (
                <option key={f.path} value={f.path}>
                  {f.path}
                </option>
              ))}
            </select>
          </label>
          {status && (
            <span className={`tnote${tex.phase === 'failed' || (tex.result && tex.result.status !== 'ok') ? ' bad' : ''}`} role="status" data-testid="compile-status">
              {status}
            </span>
          )}
          {project.engine === 'lualatex' && <span className="tnote">LuaLaTeX 는 XeLaTeX 보다 느려요</span>}
        </>,
        toolsHost,
      )
    : null;

  return (
    <>
      {tools}
      <div className="tex-engine" data-pane={pane}>
        <div className="tex-switch" role="tablist" aria-label="보기 고르기">
          {(
            [
              ['files', '파일'],
              ['source', '원고'],
              ['pdf', 'PDF'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={pane === id} onClick={() => setPane(id)}>
              {label}
            </button>
          ))}
        </div>

        <nav className="tex-files" aria-label="프로젝트 파일">
          <div className="tex-files-h">
            <span>파일 {files.length}개</span>
            <button type="button" className="btn ghost sm" onClick={() => setAdding((v) => !v)}>
              새 파일
            </button>
            <label className="btn ghost sm">
              올리기
              <input type="file" multiple hidden data-testid="tex-upload" onChange={(e) => void onUpload(e.target.files).finally(() => (e.target.value = ''))} />
            </label>
          </div>
          {adding && (
            <form className="tex-name" onSubmit={(e) => void onAdd(e)}>
              <input name="name" aria-label="새 파일 이름" placeholder="예: chapters/intro.tex" autoFocus />
              <button type="submit" className="btn primary sm">
                만들기
              </button>
            </form>
          )}
          <ul>
            {files.map((f) => (
              <li key={f.path} className={f.path === open ? 'on' : undefined}>
                {renaming === f.path ? (
                  <form className="tex-name" onSubmit={(e) => void onRename(e, f.path)}>
                    <input name="name" aria-label="바꿀 이름" defaultValue={f.path} autoFocus />
                    <button type="submit" className="btn primary sm">
                      바꾸기
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      type="button"
                      className="tex-file"
                      aria-current={f.path === open ? 'true' : undefined}
                      onClick={() => {
                        setOpen(f.path);
                        setPane('source');
                      }}
                      title={f.path}
                    >
                      <span className="nm">{f.path}</span>
                      {f.path === project.main && <span className="chip">주</span>}
                      {(counts.get(f.path) ?? 0) > 0 && <span className="chip bad">오류 {counts.get(f.path)}</span>}
                    </button>
                    {f.path === open && (
                      <span className="tex-acts">
                        {isTexSource(f.path) && f.path !== project.main && (
                          <button type="button" className="link" onClick={() => void changeProject({ main: f.path })}>
                            주 파일로
                          </button>
                        )}
                        <button type="button" className="link" onClick={() => setRenaming(f.path)}>
                          이름 바꾸기
                        </button>
                        <button type="button" className="link" onClick={() => void onDelete(f.path)}>
                          지우기
                        </button>
                      </span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <section className="tex-source" aria-label="원고">
          {openFile && !isTextFile(openFile.path) ? (
            <div className="engine-loading">
              <p>
                <b>{openFile.path}</b> 는 원고 편집기로 열 수 없는 파일이에요({formatBytes(openFile.blob.size)}).
              </p>
              <p>그림 같은 파일은 컴파일할 때 함께 보내요.</p>
            </div>
          ) : !openFile ? (
            <div className="engine-loading">왼쪽에서 파일을 고르세요.</div>
          ) : null}
          <div className="tex-cm" ref={host} hidden={!openFile || !isTextFile(openFile.path)} />
        </section>

        <section className="tex-pdf" aria-label="PDF 미리보기">
          <div className="tex-pdf-h">
            <button type="button" className="tb" aria-label="미리보기 축소" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))}>
              −
            </button>
            <span className="tnote">{Math.round(zoom * 100)}%</span>
            <button type="button" className="tb" aria-label="미리보기 확대" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))}>
              +
            </button>
            {tex.pdf && tex.result && tex.result.status !== 'ok' && <span className="tnote bad">마지막으로 성공한 PDF예요</span>}
          </div>
          <div className="tex-pdf-body">
            {tex.pdf ? (
              <PdfView bytes={tex.pdf} zoom={zoom} fit className="tex-pdf-pages" onError={(m) => toast(m, 'error')} />
            ) : (
              <div className="engine-loading">
                {avail.ok ? (
                  <p>컴파일하면 여기에 PDF가 나와요. (Ctrl+S 또는 Ctrl+Enter)</p>
                ) : (
                  <>
                    <p>{avail.message}</p>
                    {avail.reason === 'login' && (
                      <a className="btn primary" href={loginUrl(window.location.pathname)}>
                        {me?.authMode === 'dev' ? '로그인(개발용)' : '구글로 로그인'}
                      </a>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <dialog ref={noticeDialog} className="modal" aria-labelledby="tex-notice-title" onCancel={() => onNoticeAnswer(false)}>
        <h2 id="tex-notice-title">컴파일하면 프로젝트 파일이 서버로 전송돼요</h2>
        <p>
          PDF를 만들려고 이 프로젝트의 파일(원고·그림·참고문헌)을 이 서비스의 서버로 보냅니다. 서버는 받은 파일을 컴파일에 쓰고,
          <b> 마지막으로 쓴 날부터 {me?.compile?.retentionDays ?? 7}일 뒤</b> 지워요. 만든 PDF는 한 시간 뒤 지워요.
        </p>
        <p>파일은 AI 에 보내지 않아요. 프로젝트 자체는 지금처럼 이 브라우저에 저장돼요.</p>
        {me?.compile?.demo && <p className="mut">지금 서버에는 데모 컴파일러가 연결되어 있어요. 실제 TeX가 아니라 정해 둔 예시 PDF와 로그만 돌려줍니다.</p>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => onNoticeAnswer(false)}>
            취소
          </button>
          <button type="button" className="btn primary" onClick={() => onNoticeAnswer(true)}>
            확인하고 컴파일
          </button>
        </div>
      </dialog>
    </>
  );
}
