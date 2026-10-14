import { useEffect, useState } from 'react';
import { z } from 'zod';
import { storeTexProject } from '../lib/openFile';
import { importZip, TexImportError } from '../lib/texProject';
import { isQuotaError } from '../lib/docs';
import { toast } from '../state/toast';

const TemplateListSchema = z.array(z.object({ id: z.string(), title: z.string(), description: z.string(), name: z.string() }));
type Template = z.infer<typeof TemplateListSchema>[number];

const BASE = `${import.meta.env.BASE_URL}templates/`;

/** 홈의 "LaTeX 새 프로젝트": 빌드 때 묶은 템플릿(templates/latex) 중 하나로 프로젝트를 만든다. */
export default function TexTemplates({ onCreated }: { onCreated: (id: string) => void }) {
  const [list, setList] = useState<Template[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${BASE}index.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((j: unknown) => {
        const parsed = TemplateListSchema.safeParse(j);
        if (alive) setList(parsed.success ? parsed.data : []);
      })
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);

  if (!list || list.length === 0) return null;

  async function create(t: Template) {
    setBusy(t.id);
    try {
      const res = await fetch(`${BASE}${t.id}.zip`);
      if (!res.ok) throw new Error('템플릿을 받지 못했어요.');
      const blob = await res.blob();
      const id = await storeTexProject(`${t.name}.zip`, blob, importZip(new Uint8Array(await blob.arrayBuffer())));
      onCreated(id);
    } catch (e) {
      toast(e instanceof TexImportError ? e.message : isQuotaError(e) ? '이 브라우저의 저장 공간이 부족해요.' : '새 프로젝트를 만들지 못했어요.', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="tex-new-title" className="tex-new">
      <div className="sec-head">
        <h2 id="tex-new-title">LaTeX 새 프로젝트</h2>
        <span>템플릿을 골라 시작해요</span>
      </div>
      <ul>
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" disabled={busy !== null} onClick={() => void create(t)}>
              <b>{t.title}</b>
              <span>{busy === t.id ? '만드는 중…' : t.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
