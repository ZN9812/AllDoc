import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KIND_LABEL, KIND_MIME } from '@alldoc/shared';
import { applyAtomic } from './applyOps';
import { applyTextOp, segmentText, summarizeText } from './text/model';
import type { EngineHandle, EngineProps, HighlightState } from './types';

/** TXT·MD: 글을 직접 고친다. AI 가 고칠 곳은 글 뒤에 깔린 층에 청록색으로 표시한다. */
export default function TextEngine({ doc, toolsHost, onReady, onDirty, onPages, onError }: EngineProps) {
  const [text, setText] = useState<string | null>(null);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [hl, setHl] = useState<HighlightState>({ pending: [], focus: [] });
  const textRef = useRef('');
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const isMd = doc.kind === 'md';

  useEffect(() => {
    onPages(null);
    let alive = true;
    doc.blob
      .text()
      .then((t) => {
        if (!alive) return;
        textRef.current = t;
        setText(t);
      })
      .catch(() => onError('파일을 읽지 못했어요.'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const ready = text !== null;
  useEffect(() => {
    if (!ready) return;
    const handle: EngineHandle = {
      kind: doc.kind,
      canFormat: false,
      getBlob: async () => new Blob([textRef.current], { type: KIND_MIME[doc.kind] }),
      exportOptions: () => [
        {
          id: 'native',
          label: KIND_LABEL[doc.kind],
          ext: doc.kind,
          run: async () => new Blob([textRef.current], { type: KIND_MIME[doc.kind] }),
        },
      ],
      summarize: async () => summarizeText(textRef.current, doc.kind),
      apply: (ops) =>
        applyAtomic(async (op) => {
          const r = applyTextOp(textRef.current, op);
          if (!r.ok) return r;
          textRef.current = r.text;
          return { ok: true, inverse: r.inverse };
        }, ops).then((result) => {
          setText(textRef.current);
          if (result.ok) onDirty();
          return result;
        }),
      setHighlights: setHl,
    };
    onReady(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, doc.id]);

  // 글이 길어지면 입력 칸도 함께 늘려서, 문서 전체가 하나의 종이처럼 스크롤되게 한다.
  useLayoutEffect(() => {
    const ta = areaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [text, view]);

  const segments = useMemo(() => (text === null ? [] : segmentText(text, hl.pending, hl.focus)), [text, hl]);
  const previewHtml = useMemo(() => {
    if (!isMd || text === null || view !== 'preview') return '';
    return DOMPurify.sanitize(marked.parse(text, { async: false }));
  }, [isMd, text, view]);

  if (text === null) return <div className="engine-loading">문서를 여는 중…</div>;

  const tools = toolsHost
    ? createPortal(
        <>
          {isMd && (
            <>
              <button type="button" className="tb" aria-pressed={view === 'edit'} onClick={() => setView('edit')}>
                편집
              </button>
              <button type="button" className="tb" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>
                미리보기
              </button>
              <span className="tsep" />
            </>
          )}
          <span className="tnote">{text.length.toLocaleString('ko-KR')}자</span>
        </>,
        toolsHost,
      )
    : null;

  return (
    <>
      {tools}
      <div className="text-engine">
        {view === 'preview' ? (
          <div className="md-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <>
            <div className="layer" aria-hidden="true">
              {segments.map((s, i) =>
                s.mark ? (
                  <mark key={i} className={s.mark === 'focus' ? 'focus' : undefined}>
                    {s.text}
                  </mark>
                ) : (
                  <span key={i}>{s.text}</span>
                ),
              )}
              {'\n'}
            </div>
            <textarea
              ref={areaRef}
              value={text}
              spellCheck={false}
              aria-label={`${doc.name} 내용`}
              onChange={(e) => {
                textRef.current = e.target.value;
                setText(e.target.value);
                onDirty();
              }}
            />
          </>
        )}
      </div>
    </>
  );
}
