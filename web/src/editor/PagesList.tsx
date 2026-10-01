import { useEffect, useRef, useState } from 'react';
import type { PagesApi } from '../engines/types';
import { useEditor } from './store';

/** 왼쪽 쪽 목록. 보이는 쪽의 작은 그림만 만든다. */
export default function PagesList() {
  const pages = useEditor((s) => s.pages);
  if (!pages || pages.count === 0) return null;
  return (
    <aside className="pages" aria-label="쪽 목록">
      {Array.from({ length: pages.count }, (_, i) => (
        <PageThumb key={i} pages={pages} index={i} />
      ))}
    </aside>
  );
}

function PageThumb({ pages, index }: { pages: PagesApi; index: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const latest = useRef(pages);
  latest.current = pages;

  useEffect(() => {
    const el = btn.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      latest.current
        .thumb(index)
        .then(setSrc)
        .catch(() => undefined);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [index, pages.count]);

  return (
    <button ref={btn} type="button" className="pgb" aria-current={pages.current === index} aria-label={`${index + 1}쪽`} onClick={() => pages.goTo(index)}>
      <span className="th">{src ? <img src={src} alt="" /> : null}</span>
      {index + 1}
    </button>
  );
}
