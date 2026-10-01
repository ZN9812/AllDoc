import { useRef, useState } from 'react';
import { euro } from '@alldoc/shared';
import { useEditor } from '../editor/store';
import type { ExportOption } from '../engines/types';
import { downloadBlob, exportName } from '../lib/files';
import { useClickOutside } from '../lib/useClickOutside';
import { toast } from '../state/toast';

/** 내려받기. 원본은 그대로 두고, 고친 문서는 "_수정본" 이름의 새 파일로 받는다. */
export default function DownloadMenu({ name, edited }: { name: string; edited: boolean }) {
  const engine = useEditor((s) => s.engine);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  const options = engine?.exportOptions() ?? [];

  async function run(opt: ExportOption) {
    setBusy(true);
    try {
      if (opt.action) await opt.action();
      else if (opt.run) downloadBlob(await opt.run(), exportName(name, edited, opt.ext));
      setOpen(false);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '내려받지 못했어요.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const only = options.length === 1 ? options[0] : undefined;
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="btn ghost"
        disabled={!engine || busy}
        aria-haspopup={only ? undefined : 'menu'}
        aria-expanded={only ? undefined : open}
        onClick={() => (only ? void run(only) : setOpen((v) => !v))}
      >
        {busy ? '준비 중…' : '내려받기'}
      </button>
      {open && !only && (
        <div className="menu" role="menu">
          <div className="hint">원본은 그대로 두고 새 파일로 받아요</div>
          {options.map((o) => (
            <button key={o.id} type="button" role="menuitem" onClick={() => void run(o)}>
              {o.action ? o.label : `${euro(o.label)} 내려받기`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
